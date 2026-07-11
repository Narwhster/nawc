import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

type ThemeMeta = {
  theme: {
    name: string;
    appearance: "light" | "dark";
    variables: Record<`--${string}`, string>;
  };
};

const response = await fetch("/api/meta");
if (response.ok) {
  const { theme } = (await response.json()) as ThemeMeta;
  const root = document.documentElement;
  root.dataset.theme = theme.name;
  root.classList.toggle("dark", theme.appearance === "dark");
  root.style.colorScheme = theme.appearance;
  for (const [property, value] of Object.entries(theme.variables))
    root.style.setProperty(property, value);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
