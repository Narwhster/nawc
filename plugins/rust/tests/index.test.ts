import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveCargoTest, resolveRust, rust } from "../src/index.ts";

const source = `#[derive(Debug)]
pub struct Calculator {
    seed: i32,
}

impl Calculator {
    pub fn add(&self, a: i32, b: i32) -> i32 {
        a + b
    }

    pub fn scale(&self, value: i32) -> i32 {
        value * self.seed
    }
}

impl std::fmt::Display for Calculator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Calculator({})", self.seed)
    }
}

pub enum Color {
    Red,
    Green,
}

pub trait Shape {
    fn area(&self) -> f64;
}

pub mod geometry {
    pub const PI: f64 = 3.14159;
}

pub static NAME: &str = "calc";

pub type Result<T> = std::result::Result<T, String>;

macro_rules! greet {
    () => {
        println!("hi");
    };
}

fn main() {
    let calculator = Calculator { seed: 2 };
    println!("{}", calculator.add(1, 2));
}
`;

describe("Rust syntax", () => {
  it("returns the whole file without a selector", () => {
    const result = resolveRust(source, { file: "calculator.rs" });
    expect(result?.code).toBe(source);
    expect(result?.startLine).toBe(1);
  });

  it("extracts a named function", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "fn", name: "main" });
    expect(result?.code).toContain("fn main()");
    expect(result?.code).toContain("calculator.add(1, 2)");
    expect(result?.code).not.toContain("greet");
  });

  it("extracts a method from an impl block", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "fn", name: "add" });
    expect(result?.code).toContain("pub fn add(&self, a: i32, b: i32) -> i32");
    expect(result?.code).toContain("a + b");
    expect(result?.code).not.toContain("impl Calculator");
  });

  it("extracts a named struct", () => {
    const result = resolveRust(source, {
      file: "calculator.rs",
      type: "struct",
      name: "Calculator",
    });
    expect(result?.code).toContain("pub struct Calculator");
    expect(result?.code).toContain("seed: i32");
    expect(result?.startLine).toBe(2);
  });

  it("extracts a named enum", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "enum", name: "Color" });
    expect(result?.code).toContain("pub enum Color");
    expect(result?.code).toContain("Red");
  });

  it("extracts an impl block by implemented type", () => {
    const result = resolveRust(source, {
      file: "calculator.rs",
      type: "impl",
      name: "Calculator",
    });
    expect(result?.code).toContain("impl Calculator");
    expect(result?.code).toContain("pub fn scale");
  });

  it("extracts a named trait", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "trait", name: "Shape" });
    expect(result?.code).toContain("pub trait Shape");
    expect(result?.code).toContain("fn area(&self) -> f64;");
  });

  it("extracts a named module", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "mod", name: "geometry" });
    expect(result?.code).toContain("pub mod geometry");
    expect(result?.code).toContain("pub const PI");
  });

  it("extracts a named const", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "const", name: "PI" });
    expect(result?.code).toContain("pub const PI: f64 = 3.14159;");
  });

  it("extracts a named static", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "static", name: "NAME" });
    expect(result?.code).toContain('pub static NAME: &str = "calc";');
  });

  it("extracts a named type alias", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "type", name: "Result" });
    expect(result?.code).toContain("pub type Result<T>");
  });

  it("extracts a macro_rules definition", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "macro", name: "greet" });
    expect(result?.code).toContain("macro_rules! greet");
    expect(result?.code).toContain('println!("hi")');
  });

  it("returns undefined for unknown declarations", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "fn", name: "unknown" });
    expect(result).toBeUndefined();
  });

  it("returns undefined for unsupported declaration types", () => {
    const result = resolveRust(source, { file: "calculator.rs", type: "field", name: "seed" });
    expect(result).toBeUndefined();
  });
});

const testSource = `use super::Calculator;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_numbers() {
        assert_eq!(2 + 2, 4);
    }

    #[tokio::test]
    async fn fetches_data() {
        assert!(true);
    }

    fn helper() -> i32 {
        42
    }
}

#[test]
fn top_level_test() {
    assert!(true);
}
`;

describe("Cargo test syntax", () => {
  it("returns the whole file without a name", () => {
    const result = resolveCargoTest(testSource, { file: "calculator_test.rs" });
    expect(result?.code).toBe(testSource);
  });

  it("selects a #[test] function including its attribute", () => {
    const result = resolveCargoTest(testSource, {
      file: "calculator_test.rs",
      name: "adds_numbers",
    });
    expect(result?.code).toContain("#[test]");
    expect(result?.code).toContain("fn adds_numbers()");
    expect(result?.code).toContain("assert_eq!(2 + 2, 4)");
  });

  it("selects a #[tokio::test] function", () => {
    const result = resolveCargoTest(testSource, {
      file: "calculator_test.rs",
      name: "fetches_data",
    });
    expect(result?.code).toContain("#[tokio::test]");
    expect(result?.code).toContain("async fn fetches_data()");
  });

  it("selects a top-level test function", () => {
    const result = resolveCargoTest(testSource, {
      file: "calculator_test.rs",
      name: "top_level_test",
    });
    expect(result?.code).toContain("#[test]");
    expect(result?.code).toContain("fn top_level_test()");
  });

  it("returns undefined for functions without a test attribute", () => {
    const result = resolveCargoTest(testSource, { file: "calculator_test.rs", name: "helper" });
    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown tests", () => {
    const result = resolveCargoTest(testSource, { file: "calculator_test.rs", name: "unknown" });
    expect(result).toBeUndefined();
  });

  it("does not match non-test attributes like #[test_case]", () => {
    const source = `#[test_case(1, 2)]
fn parametrized() {}
`;
    const result = resolveCargoTest(source, { file: "test.rs", name: "parametrized" });
    expect(result).toBeUndefined();
  });
});

const freeFnsSource = `pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

pub fn main() {
    println!("{}", add(1, 2));
}
`;

describe("Rust runner", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "nawc-rust-"));
  writeFileSync(path.join(directory, "calculator.rs"), freeFnsSource);
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it("runs a whole file with cargo-eval without a selector", () => {
    const syntax = rust().syntax![0];
    const result = syntax.run!({ file: "calculator.rs", cwd: "/repo" });
    expect(result.command).toEqual(["cargo", "eval", "calculator.rs"]);
    expect(result.cwd).toBe("/repo");
  });

  it("runs a function via cargo-eval --expr", () => {
    const syntax = rust().syntax![0];
    const result = syntax.run!({
      file: "calculator.rs",
      type: "fn",
      name: "add",
      cwd: directory,
    });
    expect(result.command[0]).toBe("cargo");
    expect(result.command[1]).toBe("eval");
    expect(result.command[2]).toBe("--expr");
    expect(result.command[3]).toBe(`${freeFnsSource}\nadd()`);
    expect(result.script).toBeUndefined();
  });

  it("throws for unsupported selector types", () => {
    const syntax = rust().syntax![0];
    expect(() =>
      syntax.run!({ file: "calculator.rs", type: "struct", name: "Calculator", cwd: "/repo" }),
    ).toThrow("Unsupported selector type: struct");
  });

  it("honors the cargo path option for both runnable paths", () => {
    const syntax = rust({ cargo: "/opt/cargo" }).syntax![0];
    const fileResult = syntax.run!({ file: "calculator.rs", cwd: "/repo" });
    expect(fileResult.command).toEqual(["/opt/cargo", "eval", "calculator.rs"]);
    const fnResult = syntax.run!({
      file: "calculator.rs",
      type: "fn",
      name: "add",
      cwd: directory,
    });
    expect(fnResult.command[0]).toBe("/opt/cargo");
    expect(fnResult.command[1]).toBe("eval");
  });
});

describe("Cargo test runner", () => {
  it("runs all tests without a name", () => {
    const syntax = rust().syntax![1];
    const result = syntax.run!({ file: "calculator_test.rs", cwd: "/repo" });
    expect(result.command).toEqual(["cargo", "test"]);
    expect(result.cwd).toBe("/repo");
  });

  it("filters tests by name", () => {
    const syntax = rust().syntax![1];
    const result = syntax.run!({ file: "calculator_test.rs", name: "adds_numbers", cwd: "/repo" });
    expect(result.command).toEqual(["cargo", "test", "adds_numbers"]);
  });

  it("honors the cargo path option", () => {
    const syntax = rust({ cargo: "/opt/cargo" }).syntax![1];
    const result = syntax.run!({ file: "calculator_test.rs", cwd: "/repo" });
    expect(result.command[0]).toBe("/opt/cargo");
  });
});
