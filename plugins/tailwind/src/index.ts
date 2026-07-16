import tailwindcss from "@tailwindcss/vite";
import { definePlugin } from "@nawc/plugin";

export function tailwind() {
  return definePlugin({
    name: "tailwind",
    vite: () => tailwindcss(),
  });
}
