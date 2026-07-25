# NAWC

NAWC is a local, HTML-backed notebook for specification- and test-driven development with coding agents.

It turns rough ideas into durable notes, recorded decisions, runnable examples, tests, and focused implementation tickets. Because that context lives alongside the project, later agent sessions can work from the decisions that shaped it instead of starting from a plain-text issue.

## Live example

Explore the notebook, documentation, runnable examples, and interactive agent guide at [nawc.dev](https://nawc.dev).

## Quick start

Requirements:

- Node.js 22.12 or newer
- npm, pnpm, Yarn, or Bun
- A Git repository
- An installed and authenticated agent provider such as Codex, Cursor, OpenCode, or Pi

Create a notebook from your project directory:

```sh
pnpm create nawc
```

The interactive setup asks where the notebook should live and which provider, editor, theme, and plugins to use. It then writes the notebook and installs its dependencies.

Start the generated notebook:

```sh
cd nawc-notebook
pnpm nawc
```

Open [http://localhost:6292](http://localhost:6292).

You can also provide the setup choices directly:

```sh
pnpm create nawc .nawc \
  --provider codex \
  --editor vscode \
  --theme dark \
  --plugins core,nawc-skills,typescript,vitest
```

## How it works

Notes are plain HTML files under the notebook's `src/` directory. A `nawc.config.ts` file connects the notebook to your project and selects its capabilities:

```ts
import { core } from "@nawc/core";
import { nawcSkills } from "@nawc/nawc-skills";
import { codex } from "@nawc/provider-codex";
import { typescript } from "@nawc/syntax-typescript";
import { vitest } from "@nawc/syntax-vitest";
import { defineConfig, nawcLight, vscode } from "@nawc/cli";

export default defineConfig({
  plugins: [core(), nawcSkills(), typescript(), vitest()],
  provider: codex(),
  editor: vscode(),
  theme: nawcLight(),
  baseDir: "..",
});
```

Plugins add note elements, runnable syntax, previews, and agent skills. Providers connect conversations to an agent runtime. Editor adapters open source references at the correct file and location.

Run `nawc splash` to find notes whose source references touch files changed in the working tree:

```sh
nawc splash
nawc splash --depth 1
```

## First-party packages

- `@nawc/cli` and `create-nawc` — notebook server, CLI, and project generator
- `@nawc/core`, `@nawc/react`, `@nawc/tldraw`, and `@nawc/tailwind` — notebook capabilities
- `@nawc/syntax-typescript`, `@nawc/syntax-vitest`, `@nawc/syntax-java`, `@nawc/syntax-junit`, and `@nawc/syntax-rust` — source and runnable syntax support
- `@nawc/provider-codex`, `@nawc/provider-cursor`, `@nawc/provider-opencode`, and `@nawc/provider-pi` — agent runtime adapters
- `@nawc/editor-vscode`, `@nawc/editor-cursor`, `@nawc/editor-zed`, `@nawc/editor-idea`, `@nawc/editor-webstorm`, and `@nawc/editor-clion` — editor integrations
- `@nawc/theme-nawc` — built-in light and dark themes
- `@nawc/site` — static NAWC site generation

## Development

This repository uses [Vite+](https://viteplus.dev/guide/):

```sh
vp install
vp check
vp test
vp run -r build
```

Run the repository's own notebook and website with:

```sh
vp run nawc
vp run site:dev
```

## License

NAWC is free software licensed under the [GNU Affero General Public License v3.0 or later](./LICENSE).
