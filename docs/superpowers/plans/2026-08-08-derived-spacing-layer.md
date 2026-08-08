# Derived Spacing Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit a density-aware `--space-*` layer from the token pipeline so the consuming site can delete its hand-maintained `_spacing.scss`.

**Architecture:** A new pure module `src/spacing/emitDerived.ts` mirrors the existing `src/radius/emitDerived.ts`: it takes a list of `sp-*` primitive token names and returns a CSS string wrapping each in `calc(var(--sp-N) * var(--space-scale))`. `src/build/buildTokens.ts` discovers the step list from the `primitives-dimension` collection in `manifest.json` and appends the emitter's output to the CSS accumulator, beside the existing radius call.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Style Dictionary v5, Vitest, Playwright (Chromium) for the render gate.

## Global Constraints

- **ESM with `.js` import specifiers even for `.ts` sources.** `import { x } from "./foo.js"`.
- **Never add the `size/rem` transform** to `src/transforms/cssPlatform.ts`. No task here touches that file.
- **Tests live beside their source as `*.test.ts`** and run via `npm test`.
- **Shared modules live in `src/`.** Never copy a module to make it reachable — import it. This repo has been bitten twice by copied modules drifting.
- Derived CSS layer is **pure `var()` references, no build-time arithmetic** — the same constraint the radius layer enforces. The one literal is `--space-scale: 1`.
- Emitted spacing values are **`rem`**, inherited from the primitives; the emitter never converts units itself.
- Full verification command for every task: `npm test`.

---

### Task 1: The spacing emitter module

**Files:**
- Create: `src/spacing/emitDerived.ts`
- Test: `src/spacing/emitDerived.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `emitDerivedSpacingCss(steps: string[], selector?: string): string`. `steps` holds full primitive token names (`["sp-0", "sp-2", …]`), not bare numbers. Default selector is `":root, [data-density]"`. Returns both the `:root` knob-default block and the derived block as one string. Throws `Error` on a step name not prefixed `sp-`. Task 2 imports this.

- [ ] **Step 1: Write the failing test**

Create `src/spacing/emitDerived.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emitDerivedSpacingCss } from "./emitDerived.js";

const STEPS = ["sp-0", "sp-2", "sp-4", "sp-16", "sp-124"];

/**
 * The derived block only — everything from the derived selector onward.
 * The `:root` knob-default block above it legitimately holds a literal
 * (`--space-scale: 1`), so purity assertions must not see it.
 */
function derivedBlock(css: string, selector = ":root, [data-density]"): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start);
}

describe("emitDerivedSpacingCss", () => {
  const css = emitDerivedSpacingCss(STEPS);

  it("declares the knob default at :root, separate from the derived block", () => {
    // Not in the shared block: [data-density] and a consumer's
    // [data-density="compact"] both have specificity 0,1,0. If the default
    // lived in the shared block it would tie and win on source order —
    // generated CSS is imported first — silently clobbering every override.
    // The symptom is "compact mode does nothing", which is very hard to
    // trace back to a generator decision.
    expect(css.trimStart().startsWith(":root {")).toBe(true);
    expect(css).toContain("--space-scale: 1;");

    const derived = derivedBlock(css);
    expect(derived).not.toContain("--space-scale:");
  });

  it("covers :root and any [data-density] scope by default", () => {
    // :root alone is not enough: a custom property substitutes var() where
    // it is *declared*, so a block emitted only under :root would never
    // re-resolve --space-scale for a nested [data-density] subtree. This is
    // the exact defect that shipped in the radius layer.
    expect(css).toContain(":root, [data-density] {");
    expect(css.trimEnd().endsWith("}")).toBe(true);
  });

  it("emits one --space-N per sp-N step, in the order given", () => {
    for (const step of STEPS) {
      const n = step.slice("sp-".length);
      expect(css).toContain(
        `--space-${n}: calc(var(--${step}) * var(--space-scale));`,
      );
    }
  });

  it("emits nothing beyond the steps it was given", () => {
    const declared = [...derivedBlock(css).matchAll(/^\s*(--space-[\w-]+):/gm)];
    expect(declared).toHaveLength(STEPS.length);
  });

  it("emits no literal values in the derived block — pure references", () => {
    // Every declaration must reference other custom properties, never a
    // number of its own. Reference names legitimately contain digits
    // (--sp-124), so strip var(--…) before checking what remains.
    const declarations = [
      ...derivedBlock(css).matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm),
    ];
    expect(declarations.length).toBe(STEPS.length);
    for (const [, name, value] of declarations) {
      const withoutRefs = value.replace(/var\(--[\w-]+\)/g, "");
      expect(withoutRefs, `${name} must not contain a literal number`).not.toMatch(/\d/);
    }
  });

  it("throws on a step name that is not prefixed sp-", () => {
    expect(() => emitDerivedSpacingCss(["size-4"])).toThrow(/sp-/);
  });

  it("accepts a custom selector for the derived block only", () => {
    const custom = emitDerivedSpacingCss(STEPS, ".theme");
    expect(custom).toContain(".theme {");
    expect(custom.trimStart().startsWith(":root {")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/spacing/emitDerived.test.ts`
Expected: FAIL — cannot resolve `./emitDerived.js`.

- [ ] **Step 3: Write the implementation**

Create `src/spacing/emitDerived.ts`:

```ts
/**
 * Emits the derived spacing layer — the consumer-facing API that components
 * actually use.
 *
 * A custom property's *computed value* is its specified value with every
 * var() already substituted, resolved against the element on which the
 * property is declared — not the element that later consumes it. If
 * --space-16 is declared only on :root, var(--space-scale) is substituted
 * exactly once, using :root's value, and that finished value is what every
 * descendant inherits. A descendant that overrides --space-scale does not
 * change --space-16 on that descendant, because --space-16 was never
 * re-declared — and therefore never re-substituted — there.
 *
 * The fix is to re-declare the block at every scope that can change the
 * knob. The default selector, ":root, [data-density]", does that: any
 * element carrying data-density gets its own copy of every --space-* value,
 * re-substituted against its own cascade. An element with no data-density of
 * its own is unaffected and correctly inherits the finished values from the
 * nearest ancestor that does declare them.
 *
 * This is the same defect, and the same fix, as src/radius/emitDerived.ts.
 *
 * The knob default (--space-scale: 1) is emitted in its OWN :root block,
 * deliberately not in the shared block. [data-density] and a consumer's
 * [data-density="compact"] both have specificity 0,1,0; a default in the
 * shared block would tie with the consumer's rule and win on source order,
 * because generated CSS is imported first. Compact mode would silently do
 * nothing.
 *
 * Depends on the --sp-* primitives, which the token build emits from DTCG
 * sources. This layer performs no unit conversion of its own — values stay
 * in whatever unit the primitives carry (rem, per the unit contract).
 */
export function emitDerivedSpacingCss(
  steps: string[],
  selector = ":root, [data-density]",
): string {
  const lines: string[] = [];

  lines.push(":root {");
  lines.push("  /* Global density knob — override on :root or any [data-density] scope */");
  lines.push("  --space-scale: 1;");
  lines.push("}");
  lines.push("");

  lines.push(`${selector} {`);
  lines.push("  /* Derived spacing layer — generated from src/spacing/emitDerived.ts */");
  for (const step of steps) {
    if (!step.startsWith("sp-")) {
      throw new Error(
        `emitDerivedSpacingCss: expected a step named "sp-<n>", got "${step}"`,
      );
    }
    const n = step.slice("sp-".length);
    lines.push(`  --space-${n}: calc(var(--${step}) * var(--space-scale));`);
  }
  lines.push("}");

  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/spacing/emitDerived.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. 9 existing files plus the new one; nothing else should change.

- [ ] **Step 6: Commit**

```bash
git add src/spacing/emitDerived.ts src/spacing/emitDerived.test.ts
git commit -m "feat(spacing): add the derived spacing layer emitter"
```

---

### Task 2: Wire the emitter into the build

**Files:**
- Modify: `src/build/buildTokens.ts` (import near line 6; discovery after the manifest loop ~line 84; emit call beside the radius call ~line 194)
- Test: `src/build/buildTokens.test.ts` (append to the existing `describe` block)

**Interfaces:**
- Consumes: `emitDerivedSpacingCss(steps, selector?)` from Task 1.
- Produces: `dist/css/tokens.css` now contains a `:root { --space-scale: 1; }` block and a `:root, [data-density] { … }` block with one `--space-N` per `sp-N` in the DTCG source. Task 3's render gate depends on this.

- [ ] **Step 1: Write the failing test**

Append these cases inside the existing `describe("emitted tokens.css unit contract", …)` block in `src/build/buildTokens.test.ts`, after the `"scopes the derived radius layer…"` test:

```ts
  it("emits the derived spacing layer", () => {
    expect(css).toContain("--space-scale: 1;");
    expect(css).toContain("--space-16: calc(var(--sp-16) * var(--space-scale));");
  });

  it("scopes the derived spacing layer to :root and every [data-density] scope", () => {
    // Same substitution-site rule as radius: a block emitted only under
    // :root never re-resolves --space-scale for a nested subtree.
    expect(css).toContain(":root, [data-density] {");
  });

  it("derives a --space-N for every sp-N primitive in the source", () => {
    // Guards against the step list silently falling out of sync with the
    // Figma export — a new sp-* step must flow through with no code change.
    const primitives = [...css.matchAll(/^\s*--(sp-\d+):/gm)].map((m) => m[1]);
    expect(primitives.length).toBeGreaterThan(0);
    for (const step of primitives) {
      const n = step.slice("sp-".length);
      expect(css).toContain(`--space-${n}: calc(var(--${step}) * var(--space-scale));`);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/build/buildTokens.test.ts`
Expected: FAIL — the three new tests fail on missing `--space-scale` / `--space-16`. The pre-existing tests in the file must still pass.

- [ ] **Step 3: Add the import**

In `src/build/buildTokens.ts`, directly below the existing radius import on line 6:

```ts
import { emitDerivedRadiusCss } from "../radius/emitDerived.js";
import { emitDerivedSpacingCss } from "../spacing/emitDerived.js";
```

- [ ] **Step 4: Discover the step list**

In `src/build/buildTokens.ts`, insert after the `for (const styleName of Object.keys(manifest.styles))` loop closes (currently line 84) and before `mkdirSync(cssOutDir, …)`:

```ts
  // The derived spacing layer's step list is read from the DTCG source rather
  // than hardcoded, so a step added or renamed in Figma flows through with no
  // code change. Only `sp-<digits>` qualifies; `size-*` is deliberately
  // excluded — it feeds sizing-touch-min, an accessibility floor that must not
  // be scaled by a density knob.
  const spacingSteps: string[] = [];
  const dimensionCollection = manifest.collections["primitives-dimension"];
  if (dimensionCollection) {
    for (const files of Object.values(dimensionCollection.modes)) {
      for (const file of files) {
        const raw = JSON.parse(
          readFileSync(join(tokensDir, file), "utf-8"),
        ) as Record<string, unknown>;
        for (const key of Object.keys(raw)) {
          if (/^sp-\d+$/.test(key) && !spacingSteps.includes(key)) {
            spacingSteps.push(key);
          }
        }
      }
    }
  }
  spacingSteps.sort(
    (a, b) => Number(a.slice("sp-".length)) - Number(b.slice("sp-".length)),
  );
```

- [ ] **Step 5: Append the emitted layer**

In `src/build/buildTokens.ts`, immediately after the existing radius emit (currently line 194, `cssOutput += "\n" + emitDerivedRadiusCss() + "\n";`):

```ts
  // Derived spacing layer — same substitution-site reasoning as radius above;
  // see src/spacing/emitDerived.ts. Emitted only when the source actually has
  // sp-* steps, so a token export without them produces no dead block.
  if (spacingSteps.length > 0) {
    cssOutput += "\n" + emitDerivedSpacingCss(spacingSteps) + "\n";
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/build/buildTokens.test.ts`
Expected: PASS, 12 tests (9 pre-existing + 3 new).

- [ ] **Step 7: Build and eyeball the output**

Run: `npm run build:tokens && grep -n -- "--space-scale\|--space-16\|data-density" dist/css/tokens.css`
Expected: `--space-scale: 1;` under a `:root {` block, a `:root, [data-density] {` block, and `--space-16: calc(var(--sp-16) * var(--space-scale));`.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS. Note the pre-existing `"emits no px values at all"` test already excludes `calc(`/`min(` lines, so the new `calc()` declarations do not trip it.

- [ ] **Step 9: Commit**

```bash
git add src/build/buildTokens.ts src/build/buildTokens.test.ts
git commit -m "feat(spacing): emit the derived spacing layer from the build"
```

---

### Task 3: Rendering gate

**Files:**
- Create: `src/test-support/launchChromium.ts`
- Modify: `src/radius/render.test.ts:21-41` (remove the local helper, import the shared one)
- Test: `src/spacing/render.test.ts`

**Interfaces:**
- Consumes: the built `tokens.css` from Task 2.
- Produces: `launchChromium(): Promise<Browser>` from `src/test-support/launchChromium.ts`, shared by both render tests.

**Why this task exists:** every other gate in this repo asserts on emitted CSS *text*, which structurally cannot observe cascade or custom-property substitution. That blind spot shipped the radius `:root`-only bug — textually flawless, behaviourally inert. This is the only kind of test that catches it for spacing.

- [ ] **Step 1: Extract the shared Chromium launcher**

Create `src/test-support/launchChromium.ts`, moving the helper verbatim out of `src/radius/render.test.ts` (lines 21-41). Copying it instead of moving it is exactly the drift this repo has already been bitten by twice.

```ts
/**
 * Shared Chromium launcher for the rendering gates.
 *
 * Lives in src/ rather than being duplicated per test file: this repo has
 * twice been bitten by a module copied out of its home and then drifting.
 */
import { chromium, type Browser } from "playwright";
import { existsSync } from "fs";

/** System Chromium builds to fall back on when Playwright's own is not installed. */
const SYSTEM_CHROMIUM = [
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

export async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch {
    const found = SYSTEM_CHROMIUM.find((p) => existsSync(p));
    if (found) return await chromium.launch({ executablePath: found });
    throw new Error(
      "No Chromium available for the rendering gate.\n" +
        "Install Playwright's browser with:  npx playwright install chromium\n" +
        "(or install Chrome/Chromium/Brave/Edge in /Applications).",
    );
  }
}
```

- [ ] **Step 2: Point the radius render test at the shared launcher**

In `src/radius/render.test.ts`, delete the `SYSTEM_CHROMIUM` constant and the local `launchChromium` function (lines 21-41). Then replace the two import lines

```ts
import { chromium, type Browser, type Page } from "playwright";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
```

with

```ts
import type { Browser, Page } from "playwright";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { launchChromium } from "../test-support/launchChromium.js";
```

`chromium` and `existsSync` were used only by the extracted helper; `Browser` and `Page` are still needed for the module-level `let` declarations, and the three remaining `fs` functions are used by `beforeAll`/`afterAll`.

- [ ] **Step 3: Verify the radius gate still passes**

Run: `npx vitest run src/radius/render.test.ts`
Expected: PASS, 6 tests. This confirms the extraction was behaviour-neutral before anything new is built on it.

- [ ] **Step 4: Write the failing spacing render test**

Create `src/spacing/render.test.ts`:

```ts
/**
 * Rendering gate for the derived spacing layer.
 *
 * Text assertions cannot see cascade or custom-property substitution. That
 * blind spot is precisely how the radius `:root`-only bug shipped: the
 * emitted CSS was textually perfect and behaviourally dead for every nested
 * scope. This file builds the real stylesheet, loads it in a real browser,
 * and asserts on getComputedStyle.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser, Page } from "playwright";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTokens } from "../build/buildTokens.js";
import { launchChromium } from "../test-support/launchChromium.js";

let browser: Browser;
let page: Page;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "spacing-gate-"));
  const { cssPath } = await buildTokens({
    cssOutDir: join(outDir, "css"),
    scssOutDir: join(outDir, "scss"),
  });
  const css = readFileSync(cssPath, "utf-8");

  browser = await launchChromium();
  page = await browser.newPage();
  // The second <style> stands in for a consumer stylesheet imported after
  // tokens.css — the realistic ordering, and the one that makes the
  // specificity tie in the third test meaningful.
  await page.setContent(`<!doctype html><html><head><style>
${css}
.pad { padding: var(--space-16); }
</style><style>
[data-density='compact'] { --space-scale: 0.8; }
</style></head><body>
  <div class="pad" id="bare">x</div>
  <div data-density style="--space-scale: 0.8"><div class="pad" id="nested">x</div></div>
  <div data-density style="--space-scale: 0.8">
    <div data-density style="--space-scale: 1"><div class="pad" id="resetInDense">x</div></div>
  </div>
</body></html>`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  rmSync(outDir, { recursive: true, force: true });
});

const padding = (sel: string) =>
  page.evaluate(
    (s) => getComputedStyle(document.querySelector(s)!).paddingTop,
    sel,
  );

describe("spacing density (rendered)", () => {
  it("resolves the :root default", async () => {
    // --sp-16 is 1rem; scale 1 -> 16px at the default root font size.
    await expect(padding("#bare")).resolves.toBe("16px");
  });

  it("applies density set on a NESTED element, not just the document root", async () => {
    // The regression this gate exists for. With the derived block emitted
    // only under :root this returns "16px" — silently identical to no
    // density at all.
    const nested = await padding("#nested");
    expect(nested).not.toBe("16px");
    expect(nested).toBe("12.8px"); // 16px x 0.8
  });

  it("lets a deeper scope reset density inherited from an ancestor", async () => {
    await expect(padding("#resetInDense")).resolves.toBe("16px");
  });

  it("lets a consumer stylesheet override the knob on the document root", async () => {
    // --space-scale: 1 ships in its own :root block precisely so this works.
    // [data-density] and [data-density='compact'] tie at specificity 0,1,0;
    // if the default lived in the shared block it would win on source order
    // (generated CSS is imported first) and compact mode would do nothing.
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-density", "compact"),
    );
    const compact = await padding("#bare");
    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-density"),
    );
    expect(compact).toBe("12.8px");
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/spacing/render.test.ts`
Expected: PASS, 4 tests.

If Chromium is missing the helper throws with install instructions; run `npx playwright install chromium` and retry.

- [ ] **Step 6: Prove the gate actually gates**

Temporarily change the default selector in `src/spacing/emitDerived.ts` from `":root, [data-density]"` to `":root"`, then run `npx vitest run src/spacing/render.test.ts`.
Expected: the nested-density and consumer-override tests go RED. **Revert the change** and re-run to confirm green. A gate that cannot fail is not a gate.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS across 11 test files.

- [ ] **Step 8: Commit**

```bash
git add src/test-support/launchChromium.ts src/radius/render.test.ts src/spacing/render.test.ts
git commit -m "test(spacing): add a rendering gate for the density cascade"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.md` — table rows at lines 164-165, styles paragraph at 168-172, naming examples at 176-179, unit-contract sentence at 210-212, a new `## Spacing` section before `## Fluid typography` (line 305), repo layout block at ~line 400

**Interfaces:**
- Consumes: the shipped behaviour from Tasks 1-3.
- Produces: nothing code-facing.

**Context:** two of these corrections are drift the 2026-08-08 Figma export introduced independently of this feature — the README still describes tokens named `space-*` and a semantic `spacing-*` family that the current export does not contain, and still documents `effects.styles.tokens.json`, which that export deleted along with its manifest entry. The user confirmed the effects deletion was intentional.

- [ ] **Step 1: Correct the token architecture table**

In `README.md`, replace line 164-165:

```markdown
| `primitives-dimension` | `mode-1` | The `space-*` / `size-*` scale |
| `dimension` | `mode-1` | Semantic spacing (`spacing-layout-stack-md`, …) |
```

with:

```markdown
| `primitives-dimension` | `mode-1` | The `sp-*` spacing scale and the `size-*` scale |
| `dimension` | `mode-1` | Semantic sizing (`sizing-control-md`, `sizing-icon-sm`, …) |
```

- [ ] **Step 2: Drop the deleted effects styles from the styles paragraph**

Replace lines 168-172:

```markdown
The manifest also has a `styles` block, always folded into the base pass:
`typography.styles.tokens.json` (composite `$type: typography` tokens, the
source of the SCSS mixins) and `effects.styles.tokens.json` (shadow tokens
`brand-low|medium|high`, `neutral-low|medium|high`).
```

with:

```markdown
The manifest also has a `styles` block, always folded into the base pass:
`typography.styles.tokens.json` (composite `$type: typography` tokens, the
source of the SCSS mixins).
```

- [ ] **Step 3: Correct the naming examples**

Replace lines 176-179:

```markdown
- Primitives: `{category}-{scale}` — `color-neutral-500`, `font-size-1300`,
  `space-4`
- Semantic: `{category}-{context}-{variant}` — `color-control-border-error`,
  `spacing-layout-stack-md`
```

with:

```markdown
- Primitives: `{category}-{scale}` — `color-neutral-500`, `font-size-1300`,
  `sp-4`
- Semantic: `{category}-{context}-{variant}` — `color-control-border-error`,
  `sizing-control-md`
```

- [ ] **Step 4: Correct the unit-contract sentence**

Replace lines 210-212:

```markdown
The rule is absolute, including where it looks odd: `radius-full` is authored
as `9999px` and ships as `624.9375rem`, and the offsets inside the `effects`
shadow tokens are in `rem` too.
```

with:

```markdown
The rule is absolute, including where it looks odd: `radius-full` is authored
as `9999px` and ships as `624.9375rem`.
```

- [ ] **Step 5: Fix the `outputReferences` example**

Line 124-125 illustrates reference chains with `--spacing-layout-stack-md: var(--space-4)`, neither of which exists. Replace:

```markdown
`var()` chains rather than flattened values (`--spacing-layout-stack-md:
var(--space-4)`). Overriding a primitive at runtime therefore propagates to
```

with:

```markdown
`var()` chains rather than flattened values (`--sizing-icon-md:
var(--size-6)`). Overriding a primitive at runtime therefore propagates to
```

- [ ] **Step 6: Add the Spacing section**

Insert immediately before `## Fluid typography` (line 305). The outer fence
below is four backticks so the nested CSS fences survive; write only the inner
content into the README.

````markdown
## Spacing

Spacing ships as two layers, the same split radius uses.

The **primitive layer** comes from the DTCG tokens: `--sp-0` through
`--sp-124`, emitted in `rem` by the normal base pass. These are the
Figma-owned values and are never wrapped or rewritten.

The **derived layer** is generated by `src/spacing/emitDerived.ts` and is what
components consume:

```css
:root {
  --space-scale: 1;
}

:root, [data-density] {
  --space-16: calc(var(--sp-16) * var(--space-scale));
  /* … one per sp-* step */
}
```

`--space-scale` is a density knob. Set it on `:root` for a global change, or on
any element carrying `data-density` for a subtree:

```html
<aside data-density style="--space-scale: 0.8">…</aside>
```

Two things about that emission are load-bearing.

**The derived block is re-declared at `[data-density]`, not only at `:root`.**
A custom property substitutes `var()` where it is *declared*; a `:root`-only
block resolves `--space-scale` once against `:root` and descendants inherit the
finished value, so overriding the knob deeper down does nothing. This is the
same trap documented at length under Radius, and `src/spacing/render.test.ts`
is the gate that catches it.

**`--space-scale: 1` sits in its own `:root` block.** `[data-density]` and a
consumer's `[data-density="compact"]` both have specificity 0,1,0. A default in
the shared block would tie and win on source order — generated CSS is imported
first — so every consumer override would silently do nothing.

The step list is read from the `primitives-dimension` collection at build time
rather than hardcoded, so a step added or renamed in Figma flows through with
no code change.

`size-*` is deliberately **not** scaled. It feeds `sizing-touch-min`, an
accessibility floor; multiplying that by a compact density would push touch
targets under the minimum.
````

- [ ] **Step 7: Update the repo layout block**

In the layout block near line 400, add after the `radius/` line:

```
  spacing/                    # emitDerived.ts (css layer) — density knob
```

and after the `drift/token-drift.ts` line:

```
  test-support/               # shared test helpers (Chromium launcher)
```

- [ ] **Step 8: Verify the docs match reality**

Run: `npm run build:tokens && grep -c -- "--space-" dist/css/tokens.css`
Expected: a non-zero count matching the number of `sp-*` steps plus one for `--space-scale`.

Then re-read the new section against the actual emitted block to confirm the example CSS matches what ships.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add README.md
git commit -m "docs: document the derived spacing layer, correct dimension drift"
```

---

## Notes for the executor

- **Do not** wrap `size-*` or any `sizing-*` token in the density knob. That boundary is a deliberate accessibility decision recorded in the spec, not an oversight.
- **Do not** add `--space-scale` to `src/tokens/`. Everything in that directory is overwritten wholesale by the Figma export — that is how `effects.styles.tokens.json` disappeared. The knob is generator-owned on purpose.
- The consuming site migrates by find-replacing `var(--sp-` with `var(--space-` and deleting its `_spacing.scss`. That is out of scope for this repo; do not attempt it here.
- `npm run check:token-drift` already covers `sp-*` — `namesAt` walks every collection in the manifest — so a future export removing a step reports as breaking with no extra work.
