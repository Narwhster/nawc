import { parse, BaseJavaCstVisitorWithDefaults } from "java-parser";
import {
  definePlugin,
  type NawcPlugin,
  type ResolvedSource,
  type RunResult,
  type SourceSelection,
} from "@nawc/plugin";
import path from "node:path";

export const junitSkill = `---
name: junit
description: Use when writing code or runnable blocks for JUnit tests.
---

# JUnit syntax

Use \`syntax="junit"\` or \`syntax="test"\` for JUnit source.

## Code blocks

Without \`name\`, the whole test file is referenced. With \`name\`, select a test method annotated with \`@Test\` or \`@org.junit.Test\`. The name is the Java method name; no declaration type is required.

## Runnable blocks

Without \`name\`, run the whole test class. With \`name\`, run the selected method. The runner uses the JUnit Platform Console Standalone JAR, configurable with \`jar\`, and classpath configurable with \`classpath\`.
`;

type TestMethodInfo = {
  readonly name: string;
  readonly className: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startOffset: number;
  readonly endOffset: number;
};

class JUnitTestCollector extends BaseJavaCstVisitorWithDefaults {
  readonly tests: TestMethodInfo[] = [];
  private currentClass = "";

  constructor() {
    super();
    this.validateVisitor();
  }

  classDeclaration(ctx: any) {
    const normalClass = ctx.normalClassDeclaration?.[0];
    if (normalClass) {
      const name = normalClass.children?.typeIdentifier?.[0]?.children?.Identifier?.[0]?.image;
      if (name) {
        const previousClass = this.currentClass;
        this.currentClass = name;
        super.classDeclaration(ctx);
        this.currentClass = previousClass;
        return;
      }
    }
    super.classDeclaration(ctx);
  }

  methodDeclaration(ctx: any) {
    const header = ctx.methodHeader?.[0];
    const name = header?.children?.methodDeclarator?.[0]?.children?.Identifier?.[0]?.image;
    if (name && this.currentClass) {
      const modifiers = ctx.methodModifier ?? [];
      const hasTestAnnotation = modifiers.some((m: any) => {
        const annotation = m.children?.annotation?.[0];
        if (!annotation) return false;
        const typeName = annotation.children?.typeName?.[0];
        const identifier = typeName?.children?.Identifier;
        if (!identifier) return false;
        const annotationName = identifier.map((id: any) => id.image).join(".");
        return annotationName === "Test" || annotationName === "org.junit.Test";
      });
      if (hasTestAnnotation) {
        const body = ctx.methodBody?.[0];
        const firstModifier = ctx.methodModifier?.[0];
        const startNode = firstModifier ?? header;
        this.tests.push({
          name,
          className: this.currentClass,
          startLine: startNode.location.startLine,
          endLine: body?.location.endLine ?? header.location.endLine,
          startOffset: startNode.location.startOffset,
          endOffset: body?.location.endOffset ?? header.location.endOffset,
        });
      }
    }
    super.methodDeclaration(ctx);
  }
}

function collectTestMethods(source: string): TestMethodInfo[] {
  const cst = parse(source);
  const visitor = new JUnitTestCollector();
  visitor.visit(cst);
  return visitor.tests;
}

export function resolveJunit(
  source: string,
  selection: SourceSelection,
): ResolvedSource | undefined {
  if (!selection.name)
    return { ...selection, code: source, startLine: 1, endLine: source.split("\n").length };

  const tests = collectTestMethods(source);
  const found = tests.find((t) => t.name === selection.name);
  if (!found) return undefined;

  const code = source.slice(found.startOffset, found.endOffset + 1);
  return {
    ...selection,
    code,
    startLine: found.startLine,
    endLine: found.endLine,
  };
}

function javaBin(jdk?: string): string {
  if (jdk) return path.join(jdk, "bin", "java");
  if (process.env.JAVA_HOME) return path.join(process.env.JAVA_HOME, "bin", "java");
  return "java";
}

export type JUnitOptions = {
  readonly jdk?: string;
  readonly jar?: string;
  readonly classpath?: string;
};

export function junit(options?: JUnitOptions): NawcPlugin {
  return definePlugin({
    name: "junit",
    syntax: [
      {
        name: "junit",
        aliases: ["test"],
        highlight: "java",
        resolve: resolveJunit,
        run: ({ file, name, cwd }): RunResult => {
          const javaPath = javaBin(options?.jdk);
          const jar = options?.jar ?? "junit-platform-console-standalone.jar";
          const classpath = options?.classpath ?? ".";
          const className = file
            .replace(/\.java$/, "")
            .split(/[\\/]/)
            .pop();
          const args = ["-jar", jar, "-cp", classpath];
          if (name) {
            args.push("--select-method", `${className}#${name}`);
          } else {
            args.push("--select-class", className!);
          }
          return { command: [javaPath, ...args], cwd };
        },
      },
    ],
    skills: [{ name: "junit", content: junitSkill }],
  });
}
