import { describe, expect, it } from "vitest";
import { resolveJunit, junit } from "../src/index.ts";

const source = `import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class CalculatorTest {
    @Test
    void testAdd() {
        assertEquals(2, Calculator.add(1, 1));
    }

    @Test
    void testSubtract() {
        assertEquals(0, Calculator.subtract(1, 1));
    }

    void helperMethod() {
        // not a test
    }
}
`;

describe("JUnit syntax", () => {
  it("returns the whole file without a selector", () => {
    const result = resolveJunit(source, { file: "CalculatorTest.java" });
    expect(result?.code).toBe(source);
    expect(result?.startLine).toBe(1);
  });

  it("extracts a test method by name", () => {
    const result = resolveJunit(source, { file: "CalculatorTest.java", name: "testAdd" });
    expect(result?.code).toContain("@Test");
    expect(result?.code).toContain("void testAdd()");
    expect(result?.startLine).toBe(5);
  });

  it("extracts a different test method", () => {
    const result = resolveJunit(source, { file: "CalculatorTest.java", name: "testSubtract" });
    expect(result?.code).toContain("void testSubtract()");
    expect(result?.startLine).toBe(10);
  });

  it("returns undefined for non-test methods", () => {
    const result = resolveJunit(source, { file: "CalculatorTest.java", name: "helperMethod" });
    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown methods", () => {
    const result = resolveJunit(source, { file: "CalculatorTest.java", name: "unknown" });
    expect(result).toBeUndefined();
  });
});

describe("JUnit runner", () => {
  it("runs a specific test method", () => {
    const syntax = junit().syntax![0];
    const result = syntax.run!({
      file: "CalculatorTest.java",
      name: "testAdd",
      cwd: "/repo",
    });
    expect(result.command[0]).toMatch(/java$/);
    expect(result.command).toContain("--select-method");
    expect(result.command).toContain("CalculatorTest#testAdd");
  });

  it("runs all tests in a class when no name specified", () => {
    const syntax = junit().syntax![0];
    const result = syntax.run!({
      file: "CalculatorTest.java",
      cwd: "/repo",
    });
    expect(result.command).toContain("--select-class");
    expect(result.command).toContain("CalculatorTest");
  });

  it("uses custom jar and classpath options", () => {
    const syntax = junit({
      jar: "/path/to/junit.jar",
      classpath: "/path/to/classes",
    }).syntax![0];
    const result = syntax.run!({
      file: "CalculatorTest.java",
      name: "testAdd",
      cwd: "/repo",
    });
    expect(result.command).toContain("/path/to/junit.jar");
    expect(result.command).toContain("/path/to/classes");
  });
});
