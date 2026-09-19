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
