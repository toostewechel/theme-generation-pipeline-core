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
  <div data-density style="--space-scale: 0.8">
    <div data-density><div class="pad" id="bareInsideDense">x</div></div>
  </div>
  <div data-density="compact"><div class="pad" id="inCompact">x</div></div>
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

  it("keeps an ancestor's density through a BARE nested [data-density] scope", async () => {
    // This is the gate on --space-scale: 1 living in its own :root block.
    // Folded into the shared block, that block re-declares --space-scale: 1
    // on every bare data-density element, resetting the inherited 0.8 and
    // rendering 16px here. Verified against both layouts in Chromium.
    //
    // Note a consumer-override test does NOT gate this: on a specificity tie
    // the later rule wins and consumer CSS loads after generated CSS, so an
    // override survives either layout. This case is the one that breaks.
    await expect(padding("#bareInsideDense")).resolves.toBe("12.8px");
  });

  it("honours a consumer stylesheet's density mode", async () => {
    // Not a gate on the block split (see above) — this asserts the public
    // API works as documented for the [data-density='compact'] pattern.
    await expect(padding("#inCompact")).resolves.toBe("12.8px");
  });
});
