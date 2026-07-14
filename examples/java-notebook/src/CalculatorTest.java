import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CalculatorTest {
    @Test
    void testAdd() {
        assertEquals(5, Calculator.add(2, 3));
        assertEquals(0, Calculator.add(-1, 1));
        assertEquals(-3, Calculator.add(-1, -2));
    }

    @Test
    void testSubtract() {
        assertEquals(6, Calculator.subtract(10, 4));
        assertEquals(0, Calculator.subtract(5, 5));
        assertEquals(-5, Calculator.subtract(0, 5));
    }

    @Test
    void testMultiply() {
        assertEquals(42, Calculator.multiply(6, 7));
        assertEquals(0, Calculator.multiply(0, 100));
        assertEquals(-6, Calculator.multiply(2, -3));
    }

    @Test
    void testDivide() {
        assertEquals(3.75, Calculator.divide(15, 4));
        assertEquals(2.5, Calculator.divide(5, 2));
        assertThrows(ArithmeticException.class, () -> Calculator.divide(1, 0));
    }
}
