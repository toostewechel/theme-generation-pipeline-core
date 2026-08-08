import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveFluidConfig } from "./loadConfig.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "fluid-load-config-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes JSON to `<dir>/<name>` and returns the full path. */
function write(dir: string, name: string, data: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(data), "utf-8");
  return path;
}

describe("resolveFluidConfig", () => {
  it("resolves a {token-name} reference through the glob", async () => {
    const dir = mkdtempSync(join(root, "basic-"));
    write(dir, "primitives-font.mode-1.tokens.json", {
      "font-size-100": { $type: "dimension", $value: { value: 14, unit: "px" } },
      "font-size-1200": { $type: "dimension", $value: { value: 48, unit: "px" } },
    });
    const configPath = write(dir, "fluid-typography.config.json", {
      baseFontSize: 16,
      viewports: { min: 320, max: 1440 },
      styles: {
        "display-xl": {
          fontSize: { min: "{font-size-100}", max: "{font-size-1200}" },
        },
      },
    });

    const resolved = await resolveFluidConfig({
      configPath,
      primitivesGlob: join(dir, "primitives-*.tokens.json"),
    });

    expect(resolved?.styles["display-xl"].fontSize).toEqual({
      minPx: 14,
      maxPx: 48,
    });
  });

  it("merges multiple primitives files, later file winning on key collision", async () => {
    // This is the semantic the glob → Object.assign → buildTokenLookup
    // refactor had to preserve: when two primitives files define the same
    // token name, whichever one the glob yields last wins the merge — not
    // the first, and not a throw.
    const dir = mkdtempSync(join(root, "merge-"));
    write(dir, "a-primitives.tokens.json", {
      "font-size-100": { $type: "dimension", $value: { value: 10, unit: "px" } },
    });
    write(dir, "b-primitives.tokens.json", {
      "font-size-100": { $type: "dimension", $value: { value: 20, unit: "px" } },
    });
    const configPath = write(dir, "fluid-typography.config.json", {
      baseFontSize: 16,
      viewports: { min: 320, max: 1440 },
      styles: {
        body: { fontSize: { min: "{font-size-100}", max: "{font-size-100}" } },
      },
    });

    const resolved = await resolveFluidConfig({
      configPath,
      primitivesGlob: join(dir, "*-primitives.tokens.json"),
    });

    // "b-primitives..." sorts after "a-primitives...", so glob yields it
    // second and Object.assign lets its value (20) overwrite the first (10).
    expect(resolved?.styles.body.fontSize).toEqual({ minPx: 20, maxPx: 20 });
  });

  it("returns null when the config file is absent", async () => {
    const dir = mkdtempSync(join(root, "missing-"));
    const resolved = await resolveFluidConfig({
      configPath: join(dir, "does-not-exist.json"),
      primitivesGlob: join(dir, "*.tokens.json"),
    });

    expect(resolved).toBeNull();
  });
});
