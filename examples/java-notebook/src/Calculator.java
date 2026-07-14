public class Calculator {
    public static int add(int a, int b) {
        return a + b;
    }

    public static int subtract(int a, int b) {
        return a - b;
    }

    public static int multiply(int a, int b) {
        return a * b;
    }

    public static double divide(int a, int b) {
        if (b == 0) {
            throw new ArithmeticException("Cannot divide by zero");
        }
        return (double) a / b;
    }

    public static void main(String[] args) {
        System.out.println("2 + 3 = " + add(2, 3));
        System.out.println("10 - 4 = " + subtract(10, 4));
        System.out.println("6 * 7 = " + multiply(6, 7));
        System.out.println("15 / 4 = " + divide(15, 4));
    }
}
