public enum Color {
    RED("#FF0000"),
    GREEN("#00FF00"),
    BLUE("#0000FF"),
    YELLOW("#FFFF00"),
    CYAN("#00FFFF"),
    MAGENTA("#FF00FF"),
    WHITE("#FFFFFF"),
    BLACK("#000000");

    private final String hex;

    Color(String hex) {
        this.hex = hex;
    }

    public String getHex() {
        return hex;
    }

    public static Color fromHex(String hex) {
        for (Color color : values()) {
            if (color.hex.equalsIgnoreCase(hex)) {
                return color;
            }
        }
        throw new IllegalArgumentException("Unknown hex color: " + hex);
    }
}
