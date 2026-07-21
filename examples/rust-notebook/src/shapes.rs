/// Traits define contracts that structs can implement. This example explores a
/// Shape hierarchy and a Color enum.
pub trait Shape {
    fn area(&self) -> f64;

    fn is_square(&self) -> bool {
        false
    }
}

pub struct Circle {
    pub radius: f64,
}

impl Shape for Circle {
    fn area(&self) -> f64 {
        std::f64::consts::PI * self.radius * self.radius
    }
}

pub struct Rectangle {
    pub width: f64,
    pub height: f64,
}

impl Rectangle {
    pub fn is_square(&self) -> bool {
        self.width == self.height
    }
}

impl Shape for Rectangle {
    fn area(&self) -> f64 {
        self.width * self.height
    }

    fn is_square(&self) -> bool {
        self.is_square()
    }
}

#[derive(Debug, PartialEq)]
pub enum Color {
    Red,
    Green,
    Blue,
}

impl Color {
    pub fn hex(&self) -> &'static str {
        match self {
            Color::Red => "#ff0000",
            Color::Green => "#00ff00",
            Color::Blue => "#0000ff",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn circle_area() {
        let circle = Circle { radius: 1.0 };
        assert!((circle.area() - std::f64::consts::PI).abs() < f64::EPSILON);
    }

    #[test]
    fn square_detection() {
        let square = Rectangle {
            width: 2.0,
            height: 2.0,
        };
        assert!(square.is_square());
    }

    #[test]
    fn color_hex() {
        assert_eq!(Color::Green.hex(), "#00ff00");
    }
}
