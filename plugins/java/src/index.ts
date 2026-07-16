import { parse, BaseJavaCstVisitorWithDefaults } from "java-parser";
import {
  definePlugin,
  type NawcPlugin,
  type ResolvedSource,
  type RunResult,
  type SourceSelection,
} from "@nawc/plugin";
import path from "node:path";

export const javaSkill = `---
name: java
description: Use when writing ref or runnable blocks for Java source.
---

# Java syntax

Use \`syntax="java"\` for Java source.

## Ref blocks

Use \`name\` and \`type\` to select a declaration. Supported types are \`class\`, \`interface\`, \`enum\`, \`method\`, and \`constructor\`. Without both selectors, the whole file is referenced.

For overloaded methods and constructors, add \`params\` with the parameter types in declaration order:

\`\`\`html
<ref file="src/VillageManager.java" syntax="java" name="processBuilding" type="method" params="BlockPos, boolean, boolean"></ref>
\`\`\`

For example, the two \`findNearestVillage\` overloads can be selected as:

\`\`\`html
<ref file="src/VillageManager.java" syntax="java" name="findNearestVillage" type="method" params="Entity"></ref>
<ref file="src/VillageManager.java" syntax="java" name="findNearestVillage" type="method" params="BlockPos, int"></ref>
\`\`\`

Parameter types are matched independent of whitespace. An empty \`params\` value selects a no-argument declaration.

## Runnable blocks

Without a selector, the Java file runs with \`java\`. A class selector runs the named class. A method selector opens the file in JShell and invokes the named method with no arguments.
`;

type DeclarationInfo = {
  readonly name: string;
  readonly type: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly isStatic: boolean;
  readonly parameters: readonly string[];
};

function normalizeParameterType(type: string): string {
  return type.replace(/\s+/g, "");
}

function splitParameterTypes(params: string): readonly string[] {
  if (params.trim() === "") return [];

  const result: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < params.length; index++) {
    const character = params[index];
    if (character === "<" || character === "(" || character === "[" || character === "{") {
      depth++;
    } else if (character === ">" || character === ")" || character === "]" || character === "}") {
      depth--;
    } else if (character === "," && depth === 0) {
      result.push(normalizeParameterType(params.slice(start, index)));
      start = index + 1;
    }
  }
  result.push(normalizeParameterType(params.slice(start)));
  return result;
}

function parameterTypes(ctx: any, source: string): readonly string[] {
  const declarator =
    ctx.methodHeader?.[0]?.children?.methodDeclarator?.[0] ?? ctx.constructorDeclarator?.[0];
  const list = declarator?.children?.formalParameterList?.[0];
  if (!list) return [];

  const parameters = [
    ...(list.children?.formalParameter ?? []),
    ...(list.children?.lastFormalParameter ?? []),
  ];
  return parameters.map((parameter: any) => {
    const regular = parameter.children?.variableParaRegularParameter?.[0];
    const variableArity = parameter.children?.variableArityParameter?.[0];
    const node = regular ?? variableArity;
    const type = node?.children?.unannType?.[0];
    if (!type) return "";
    const sourceType = source.slice(type.location.startOffset, type.location.endOffset + 1);
    if (variableArity) return normalizeParameterType(`${sourceType}...`);
    const declarator = regular?.children?.variableDeclaratorId?.[0];
    const identifier = declarator?.children?.Identifier?.[0];
    const suffix =
      identifier && declarator?.location
        ? source.slice(identifier.endOffset + 1, declarator.location.endOffset + 1)
        : "";
    return normalizeParameterType(`${sourceType}${suffix}`);
  });
}

class JavaDeclarationCollector extends BaseJavaCstVisitorWithDefaults {
  readonly declarations: DeclarationInfo[] = [];
  private readonly source: string;

  constructor(source: string) {
    super();
    this.source = source;
    this.validateVisitor();
  }

  classDeclaration(ctx: any) {
    const normalClass = ctx.normalClassDeclaration?.[0];
    if (normalClass) {
      const name = normalClass.children?.typeIdentifier?.[0]?.children?.Identifier?.[0]?.image;
      if (name) {
        this.declarations.push({
          name,
          type: "class",
          startLine: normalClass.location.startLine,
          endLine: normalClass.location.endLine,
          startOffset: normalClass.location.startOffset,
          endOffset: normalClass.location.endOffset,
          isStatic: false,
          parameters: [],
        });
      }
    }
    super.classDeclaration(ctx);
  }

  interfaceDeclaration(ctx: any) {
    const name = ctx.typeIdentifier?.[0]?.children?.Identifier?.[0]?.image;
    if (name) {
      const node = ctx.typeIdentifier[0];
      this.declarations.push({
        name,
        type: "interface",
        startLine: node.location.startLine,
        endLine: node.location.endLine,
        startOffset: node.location.startOffset,
        endOffset: node.location.endOffset,
        isStatic: false,
        parameters: [],
      });
    }
    super.interfaceDeclaration(ctx);
  }

  enumDeclaration(ctx: any) {
    const name = ctx.typeIdentifier?.[0]?.children?.Identifier?.[0]?.image;
    if (name) {
      const startNode = ctx.typeIdentifier[0];
      const endNode = ctx.enumBody?.[ctx.enumBody.length - 1];
      this.declarations.push({
        name,
        type: "enum",
        startLine: startNode.location.startLine,
        endLine: endNode?.location.endLine ?? startNode.location.endLine,
        startOffset: startNode.location.startOffset,
        endOffset: endNode?.location.endOffset ?? startNode.location.endOffset,
        isStatic: false,
        parameters: [],
      });
    }
    super.enumDeclaration(ctx);
  }

  methodDeclaration(ctx: any) {
    const header = ctx.methodHeader?.[0];
    const name = header?.children?.methodDeclarator?.[0]?.children?.Identifier?.[0]?.image;
    if (name) {
      const modifiers = ctx.methodModifier ?? [];
      const isStatic = modifiers.some((m: any) => m.children?.Static?.[0]?.image === "static");
      const body = ctx.methodBody?.[0];
      const startLine = header.location.startLine;
      const endLine = body?.location.endLine ?? header.location.endLine;
      this.declarations.push({
        name,
        type: "method",
        startLine,
        endLine,
        startOffset: header.location.startOffset,
        endOffset: body?.location.endOffset ?? header.location.endOffset,
        isStatic,
        parameters: parameterTypes(ctx, this.source),
      });
    }
    super.methodDeclaration(ctx);
  }

  constructorDeclaration(ctx: any) {
    const name =
      ctx.Identifier?.[0]?.image ??
      ctx.constructorDeclarator?.[0]?.children?.simpleTypeName?.[0]?.children?.typeIdentifier?.[0]
        ?.children?.Identifier?.[0]?.image;
    if (name) {
      const declarator = ctx.constructorDeclarator?.[0];
      const body = ctx.constructorBody?.[0];
      this.declarations.push({
        name,
        type: "constructor",
        startLine: declarator.location.startLine,
        endLine: body?.location.endLine ?? declarator.location.endLine,
        startOffset: declarator.location.startOffset,
        endOffset: body?.location.endOffset ?? declarator.location.endOffset,
        isStatic: false,
        parameters: parameterTypes(ctx, this.source),
      });
    }
    super.constructorDeclaration(ctx);
  }
}

function collectDeclarations(source: string): DeclarationInfo[] {
  const cst = parse(source);
  const visitor = new JavaDeclarationCollector(source);
  visitor.visit(cst);
  return visitor.declarations;
}

export function resolveJava(
  source: string,
  selection: SourceSelection,
): ResolvedSource | undefined {
  if (!selection.name || !selection.type)
    return { ...selection, code: source, startLine: 1, endLine: source.split("\n").length };

  const declarations = collectDeclarations(source);
  const wantedParameters =
    selection.params === undefined ? undefined : splitParameterTypes(selection.params);
  const found = declarations.find(
    (d) =>
      d.name === selection.name &&
      d.type === selection.type &&
      (wantedParameters === undefined ||
        (d.parameters.length === wantedParameters.length &&
          d.parameters.every((parameter, index) => parameter === wantedParameters[index]))),
  );
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

function jshellBin(jdk?: string): string {
  if (jdk) return path.join(jdk, "bin", "jshell");
  if (process.env.JAVA_HOME) return path.join(process.env.JAVA_HOME, "bin", "jshell");
  return "jshell";
}

export type JavaOptions = {
  readonly jdk?: string;
};

export function java(options?: JavaOptions): NawcPlugin {
  return definePlugin({
    name: "java",
    syntax: [
      {
        name: "java",
        aliases: [],
        resolve: resolveJava,
        run: ({ file, name, type, cwd }): RunResult => {
          const javaPath = javaBin(options?.jdk);
          if (!name || !type) {
            return { command: [javaPath, file], cwd };
          }
          if (type === "class") {
            return { command: [javaPath, name], cwd };
          }
          if (type === "method") {
            const className = file
              .replace(/\.java$/, "")
              .split(/[\\/]/)
              .pop();
            const jshellPath = jshellBin(options?.jdk);
            const script = `/open ${file}\n${className}.${name}()\n/exit\n`;
            return { command: [jshellPath, "-q", "-s", "-"], cwd, script };
          }
          throw new Error(`Unsupported selector type: ${type}`);
        },
      },
    ],
    skills: [{ name: "java", content: javaSkill }],
  });
}
