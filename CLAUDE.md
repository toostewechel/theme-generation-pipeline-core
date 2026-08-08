# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Transforms DTCG design tokens into CSS custom properties and SCSS mixins using
Style Dictionary v5.

**Read [README.md](README.md) first** — it is the canonical description of the
pipeline, token architecture, the dimension unit contract, and the radius and fluid
typography systems. Do not duplicate that content here; update the README instead.

## Commands

```bash
npm install              # Install dependencies
npm run build:tokens     # Build CSS + SCSS to dist/
npm run build:tokens-nd  # Same, without $description comments
npm run check:token-drift -- [--base <ref>] [--head <ref>] [--json]
npm test                 # Vitest
npm run preview:fluid    # Fluid typography configurator
npm run preview:radius   # Radius scale configurator
```

## Conventions

- **ESM with `.js` import specifiers** even for `.ts` sources: `import { x } from "./foo.js"`.
- **Never add the `size/rem` transform** to `src/transforms/cssPlatform.ts`. It silently
  disables px→rem conversion for every dimension token. See the README's unit contract
  section and the guard test in `src/transforms/cssPlatform.test.ts`.
- **Colour tokens are static inputs.** This repo has no colour generator.
- **Shared modules live in `src/`; preview tools import them via the `@project` Vite
  alias.** Never copy a module into `tools/` — that is how the fluid clamp math drifted.
- Tests live beside their source as `*.test.ts` and run via `npm test`.
