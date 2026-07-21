/// A simple utility struct with arithmetic methods. This demonstrates how NAWC
/// can reference individual items from a Rust source file.
#[derive(Debug)]
pub struct Calculator {
    pub seed: i32,
}

impl Calculator {
    pub fn new(seed: i32) -> Self {
        Self { seed }
    }

    pub fn add(&self, a: i32, b: i32) -> i32 {
        a + b
    }

    pub fn subtract(&self, a: i32, b: i32) -> i32 {
        a - b
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_numbers() {
        let calculator = Calculator::new(1);
        assert_eq!(calculator.add(2, 3), 5);
    }

    #[test]
    fn subtracts_numbers() {
        let calculator = Calculator::new(1);
        assert_eq!(calculator.subtract(10, 4), 6);
    }

    #[test]
    fn scales_by_seed() {
        let calculator = Calculator::new(3);
        assert_eq!(calculator.scale(7), 21);
    }
}
