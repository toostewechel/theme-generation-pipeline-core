/**
 * Rendering gate.
 *
 * Every other test in this repo asserts on emitted CSS *text*. Text comparison
 * structurally cannot see cascade or custom-property substitution behaviour — and
 * that blind spot shipped a real bug: the derived radius layer was emitted only
 * under `:root`, which is textually perfect and behaviourally inert for any nested
 * `[data-radius-mode]` scope, because a custom property is substituted where it is
 * declared and descendants inherit the finished value.
 *
 * This test builds the real stylesheet, loads it in a real browser, and asserts on
 * `getComputedStyle`. It is the only gate here that can catch that class of defect.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTokens } from "../build/buildTokens.js";

/** System Chromium builds to fall back on when Playwright's own is not installed. */
const SYSTEM_CHROMIUM = [
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

async function launchChromium(): Promise<Browser> {
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

let browser: Browser;
let page: Page;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "render-gate-"));
  const { cssPath } = await buildTokens({
    cssOutDir: join(outDir, "css"),
    scssOutDir: join(outDir, "scss"),
  });
  const css = readFileSync(cssPath, "utf-8");

  browser = await launchChromium();
  page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><style>
${css}
.adaptive  { border-radius: var(--radius-adaptive-xs); }
.geometric { border-radius: var(--radius-geometric-xs); }
.adaptive-md { border-radius: var(--radius-adaptive-md); }
.text { font-size: var(--font-size-200); line-height: var(--font-line-height-700); }
</style></head><body>
  <div class="adaptive-md" id="bare">x</div>
  <div data-radius-mode="pill"><div class="adaptive-md" id="nestedPill">x</div></div>
  <div data-radius-mode="pill"><div data-radius-mode="sharp"><div class="adaptive-md" id="resetInPill">x</div></div></div>
  <div data-radius-mode="rounded">
    <div class="adaptive" id="roundedAdaptiveXs">x</div>
    <div class="geometric" id="roundedGeometricXs">x</div>
  </div>
  <div class="text" id="text">x</div>
</body></html>`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  rmSync(outDir, { recursive: true, force: true });
});

const radius = (sel: string) =>
  page.evaluate(
    (s) => getComputedStyle(document.querySelector(s)!).borderRadius,
    sel,
  );

describe("radius cascade (rendered)", () => {
  it("resolves the :root default", async () => {
    // unit 4px x intensity 1 x scale-md 1
    await expect(radius("#bare")).resolves.toBe("4px");
  });

  it("applies a mode set on a NESTED element, not just the document root", async () => {
    // The regression this gate exists for. Before the fix this returned "4px",
    // silently identical to no mode at all.
    const nested = await radius("#nestedPill");
    expect(nested).not.toBe("4px");
    expect(nested).toBe("39996px"); // 4px x 9999 x 1
  });

  it("matches a root-level mode when the same mode is applied nested", async () => {
    const nested = await radius("#nestedPill");
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-radius-mode", "pill"),
    );
    const atRoot = await radius("#bare");
    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-radius-mode"),
    );
    expect(nested).toBe(atRoot);
  });

  it("lets a deeper scope reset a mode inherited from an ancestor", async () => {
    // sharp (intensity 0) inside pill — the reason the
    // [data-radius-mode='default'] block must not be "cleaned up".
    await expect(radius("#resetInPill")).resolves.toBe("0px");
  });

  it("binds the geometric cap while leaving adaptive unbounded", async () => {
    // rounded: base = 4px x 1.5 = 6px; xs scale 0.5 -> 3px adaptive, capped to 2px.
    await expect(radius("#roundedAdaptiveXs")).resolves.toBe("3px");
    await expect(radius("#roundedGeometricXs")).resolves.toBe("2px");
  });
});

describe("dimension unit contract (rendered)", () => {
  it("renders rem dimensions at the expected pixel size", async () => {
    // Guards the px->rem contract at render time, not just in emitted text:
    // --font-size-200 is 1rem and must resolve to 16px at the default root size.
    const computed = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector("#text")!);
      return { fontSize: cs.fontSize, lineHeight: cs.lineHeight };
    });
    expect(computed.fontSize).toBe("16px");
    expect(computed.lineHeight).toBe("28px"); // 1.75rem
  });
});
