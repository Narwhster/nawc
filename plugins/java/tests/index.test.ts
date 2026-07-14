import { describe, expect, it } from "vitest";
import { resolveJava, java } from "../src/index.ts";

const source = `public class Calculator {
    public static int add(int a, int b) {
        return a + b;
    }

    public int subtract(int a, int b) {
        return a - b;
    }

    public static void main(String[] args) {
        System.out.println(add(1, 2));
    }
}
`;

describe("Java syntax", () => {
  it("returns the whole file without a selector", () => {
    const result = resolveJava(source, { file: "Calculator.java" });
    expect(result?.code).toBe(source);
    expect(result?.startLine).toBe(1);
  });

  it("extracts a named class", () => {
    const result = resolveJava(source, {
      file: "Calculator.java",
      type: "class",
      name: "Calculator",
    });
    expect(result?.code).toContain("class Calculator");
    expect(result?.code).toContain("return a + b");
    expect(result?.startLine).toBe(1);
  });

  it("extracts a named method", () => {
    const result = resolveJava(source, { file: "Calculator.java", type: "method", name: "add" });
    expect(result?.code).toContain("int add(int a, int b)");
    expect(result?.code).toContain("return a + b");
  });

  it("returns undefined for unknown declarations", () => {
    const result = resolveJava(source, {
      file: "Calculator.java",
      type: "method",
      name: "unknown",
    });
    expect(result).toBeUndefined();
  });
});

describe("Java runner", () => {
  it("runs a whole file without a selector", () => {
    const syntax = java().syntax![0];
    const result = syntax.run!({ file: "Calculator.java", cwd: "/repo" });
    expect(result.command[0]).toMatch(/java$/);
    expect(result.command).toContain("Calculator.java");
  });

  it("runs a class by name", () => {
    const syntax = java().syntax![0];
    const result = syntax.run!({
      file: "Calculator.java",
      type: "class",
      name: "Calculator",
      cwd: "/repo",
    });
    expect(result.command).toContain("Calculator");
  });

  it("runs a static method via JShell", () => {
    const syntax = java().syntax![0];
    const result = syntax.run!({
      file: "Calculator.java",
      type: "method",
      name: "add",
      cwd: "/repo",
    });
    expect(result.command[0]).toMatch(/jshell$/);
    expect(result.command).toContain("-q");
    expect(result.command).toContain("-s");
    expect(result.command).toContain("-");
    expect(result.script).toContain("/open Calculator.java");
    expect(result.script).toContain("Calculator.add()");
  });
});
