# NAWC

NAWC is a local, HTML-backed notebook for specification- and test-driven development with coding agents.

## Try the showcase

```sh
pnpm install
pnpm ready
pnpm dev
```

Then open [http://localhost:6292](http://localhost:6292). The notebook in `examples/notebook` documents this repository using live source references, runnable Vitest blocks, and a sandboxed interactive prototype.

## Create a notebook

Once the packages are published, run:

```sh
pnpm create nawc
cd nawc-notebook
pnpm nawc
```

A notebook contains `nawc.config.ts`, HTML notes under `src`, and generated plugin skills under `.skills` while NAWC is running.

### Themes

Use `theme: nawcLight()` (the default) or `theme: nawcDark()` in `nawc.config.ts`. The showcase notebook uses the dark theme. Themes are plain `NawcTheme` objects, so a notebook can provide its own named light or dark palette by supplying CSS custom properties in `variables`. The semantic variables are shared by the application chrome, editor highlighting, Dockview, and runnable terminals.

## Workspace

- `packages/` — CLI/server, creator, config, plugin contracts, and React UI
- `plugins/` — editor node plugins
- `provider/` — agent harness adapters
- `syntax/` — source resolvers and runners
- `examples/` — working notebooks

Run `pnpm ready` before submitting changes.
