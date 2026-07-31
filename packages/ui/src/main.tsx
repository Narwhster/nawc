import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

type ThemeMeta = {
  baseDir: string;
  theme: {
    name: string;
    appearance: "light" | "dark";
    variables: Record<`--${string}`, string>;
  };
};

const response = await fetch("/api/meta");
let notebookId = window.location.pathname;
if (response.ok) {
  const { baseDir, theme } = (await response.json()) as ThemeMeta;
  notebookId = baseDir;
  const root = document.documentElement;
  root.dataset.theme = theme.name;
  root.classList.toggle("dark", theme.appearance === "dark");
  root.style.colorScheme = theme.appearance;
  for (const [property, value] of Object.entries(theme.variables))
    root.style.setProperty(property, value);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App notebookId={notebookId} />
  </StrictMode>,
);
