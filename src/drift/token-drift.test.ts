import { describe, it, expect } from "vitest";
import {
  collectTokenNames,
  diffNames,
  namesAt,
  type FileReader,
  type NameSource,
} from "./token-drift.js";

describe("collectTokenNames", () => {
  it("collects flat token keys and skips $-metadata", () => {
    const names = new Set<string>();
    collectTokenNames(
      {
        $description: "auto-generated",
        "color-neutral-0": { $type: "color", $value: {} },
        "color-bg-default": { $value: "{color-neutral-0}" },
      },
      names,
    );
    expect([...names].sort()).toEqual(["color-bg-default", "color-neutral-0"]);
  });

  it("joins nested group paths with a hyphen (defensive)", () => {
    const names = new Set<string>();
    collectTokenNames({ color: { neutral: { "700": { $value: {} } } } }, names);
    expect([...names]).toEqual(["color-neutral-700"]);
  });
});

describe("diffNames", () => {
  it("flags removed names as breaking, additions as safe", () => {
    const diff = diffNames(new Set(["a", "b", "c"]), new Set(["a", "b", "d"]));
    expect(diff.removed).toEqual(["c"]);
    expect(diff.added).toEqual(["d"]);
    expect(diff.unchanged).toBe(2);
    expect(diff.hasBreaking).toBe(true);
  });

  it("does not flag breaking when only additions occur", () => {
    const diff = diffNames(new Set(["a"]), new Set(["a", "b"]));
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual(["b"]);
    expect(diff.hasBreaking).toBe(false);
  });

  it("reports no change for identical sets", () => {
    const s = new Set(["a", "b"]);
    const diff = diffNames(s, new Set(s));
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.unchanged).toBe(2);
    expect(diff.hasBreaking).toBe(false);
  });

  it("excludes ignored names (string and regex) and clears hasBreaking", () => {
    const diff = diffNames(
      new Set(["color-fg", "color-prism-old"]),
      new Set(["color-fg-default"]),
      { ignore: ["color-fg", /^color-prism-/] },
    );
    expect(diff.ignored).toEqual(["color-fg", "color-prism-old"]);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual(["color-fg-default"]);
    expect(diff.hasBreaking).toBe(false);
  });

  it("returns sorted arrays", () => {
    const diff = diffNames(new Set(["b", "a"]), new Set(["d", "c"]));
    expect(diff.removed).toEqual(["a", "b"]);
    expect(diff.added).toEqual(["c", "d"]);
  });
});

describe("namesAt", () => {
  function fakeReader(files: Record<string, Record<string, string>>): FileReader {
    const key = (s: NameSource) => ("worktree" in s ? "worktree" : s.ref);
    return (source, relPath) => files[key(source)]?.[relPath] ?? null;
  }

  const manifest = JSON.stringify({
    collections: {
      color: { modes: { light: ["color.light.tokens.json"], dark: ["color.dark.tokens.json"] } },
      radius: { modes: { default: ["radius.default.tokens.json"] } },
    },
  });

  it("unions token names across all collection files", () => {
    const read = fakeReader({
      worktree: {
        "manifest.json": manifest,
        "color.light.tokens.json": JSON.stringify({ "color-fg-default": { $value: {} } }),
        "color.dark.tokens.json": JSON.stringify({ "color-bg-default": { $value: {} } }),
        "radius.default.tokens.json": JSON.stringify({ "radius-intensity": { $type: "dimension", $value: {} } }),
      },
    });
    expect([...namesAt({ worktree: true }, read)].sort()).toEqual([
      "color-bg-default",
      "color-fg-default",
      "radius-intensity",
    ]);
  });

  it("treats a file absent at the source (null) as contributing nothing", () => {
    const read = fakeReader({
      HEAD: {
        "manifest.json": manifest,
        "color.light.tokens.json": JSON.stringify({ "color-fg-default": { $value: {} } }),
      },
    });
    expect([...namesAt({ ref: "HEAD" }, read)]).toEqual(["color-fg-default"]);
  });

  it("returns an empty set when no manifest exists at the source", () => {
    expect(namesAt({ ref: "HEAD" }, fakeReader({})).size).toBe(0);
  });

  it("never reads the styles block", () => {
    const manifestWithStyles = JSON.stringify({
      collections: { color: { modes: { light: ["color.light.tokens.json"] } } },
      styles: { typography: ["typography.styles.tokens.json"] },
    });
    const read = fakeReader({
      worktree: {
        "manifest.json": manifestWithStyles,
        "color.light.tokens.json": JSON.stringify({ "color-fg-default": { $value: {} } }),
        "typography.styles.tokens.json": JSON.stringify({ "text-style-should-not-appear": { $type: "typography", $value: {} } }),
      },
    });
    const names = namesAt({ worktree: true }, read);
    expect(names.has("text-style-should-not-appear")).toBe(false);
    expect(names.has("color-fg-default")).toBe(true);
  });
});
