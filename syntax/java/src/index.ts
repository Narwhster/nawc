import { parse, BaseJavaCstVisitorWithDefaults } from "java-parser";
import type { NawcSyntax, ResolvedSource, RunResult, SourceSelection } from "@nawc/config";
import path from "node:path";

type DeclarationInfo = {
  readonly name: string;
  readonly type: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly isStatic: boolean;
};

class JavaDeclarationCollector extends BaseJavaCstVisitorWithDefaults {
  readonly declarations: DeclarationInfo[] = [];

  constructor() {
    super();
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
      });
    }
    super.methodDeclaration(ctx);
  }

  constructorDeclaration(ctx: any) {
    const name = ctx.Identifier?.[0]?.image;
    if (name) {
      const body = ctx.constructorBody?.[0];
      this.declarations.push({
        name,
        type: "constructor",
        startLine: ctx.location.startLine,
        endLine: body?.location.endLine ?? ctx.location.endLine,
        startOffset: ctx.location.startOffset,
        endOffset: body?.location.endOffset ?? ctx.location.endOffset,
        isStatic: false,
      });
    }
    super.constructorDeclaration(ctx);
  }
}

function collectDeclarations(source: string): DeclarationInfo[] {
  const cst = parse(source);
  const visitor = new JavaDeclarationCollector();
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
  const found = declarations.find((d) => d.name === selection.name && d.type === selection.type);
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

export function java(options?: JavaOptions): NawcSyntax {
  return {
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
  };
}
