import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clampReactInteractiveHeight } from "../src/height.ts";
import {
  react,
  reactPreviewHtml,
  reactPreviewPath,
  reactSkill,
  resolveReactComponent,
} from "../src/index.ts";

describe("React plugin", () => {
  it("registers the React interactive node and Vite integration", () => {
    expect(react()).toMatchObject({
      name: "react",
      client: "@nawc/react/client",
      nodes: [{ name: "react-interactive", tag: "react-interactive" }],
      skills: [{ name: "react", content: reactSkill }],
      vite: expect.any(Function),
    });
  });

  it("documents React plugin configuration and component authoring", () => {
    expect(reactSkill).toContain('import { react } from "@nawc/react"');
    expect(reactSkill).toContain(
      '<react-interactive file="path/to/component.tsx"></react-interactive>',
    );
    expect(reactSkill).toContain("default-export a React component");
  });

  it("resolves TSX files inside the configured directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nawc-react-"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "Demo.tsx"), "export default () => <p>Demo</p>");
    await expect(resolveReactComponent(root, "src/Demo.tsx")).resolves.toBe(
      await realpath(path.join(root, "src", "Demo.tsx")),
    );
    await expect(resolveReactComponent(root, "src/Demo.ts")).rejects.toThrow(".jsx or .tsx");
  });

  it("rejects component symlinks that escape the configured directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nawc-react-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "nawc-react-outside-"));
    await writeFile(path.join(outside, "Demo.tsx"), "export default () => null");
    await symlink(path.join(outside, "Demo.tsx"), path.join(root, "Demo.tsx"));
    await expect(resolveReactComponent(root, "Demo.tsx")).rejects.toThrow("escapes");
  });

  it("creates a React root for the component's default export", () => {
    expect(reactPreviewHtml("/project/Demo.tsx")).toContain('import("react-dom/client")');
    expect(reactPreviewHtml("/project/Demo.tsx")).toContain('import("/@fs//project/Demo.tsx")');
    expect(reactPreviewHtml("/project/Demo.tsx")).toContain("nawc:interactive-resize");
  });

  it("uses a distinct Vite HTML identity for every component revision", () => {
    const counter = reactPreviewPath("/project/Counter.tsx", "0");

    expect(reactPreviewPath("/project/NoteWheel.tsx", "0")).not.toBe(counter);
    expect(reactPreviewPath("/project/Counter.tsx", "1")).not.toBe(counter);
    expect(counter).toMatch(/^\/@nawc\/react-interactive\/[a-f0-9]{24}$/);
  });

  it("allows React previews to shrink below the former minimum height", () => {
    expect(clampReactInteractiveHeight(96)).toBe(96);
    expect(clampReactInteractiveHeight(-1)).toBe(0);
    expect(clampReactInteractiveHeight(1_000)).toBe(768);
  });
});
