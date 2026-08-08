import {
  generateClamp,
  generateUnitlessClamp,
  interpolateAtViewport,
} from "@project/src/fluid/generateClamp.js";
import {
  buildTokenLookup,
  resolveConfig,
  type FluidTypographyConfig,
  type ResolvedFluidConfig,
  type ResolvedLineHeight,
} from "@project/src/fluid/resolveConfig.js";
import "./fonts.css";
import "./styles.css";

// Config — always exists in the repo, static import via alias
import defaultConfig from "@project/src/fluid-typography.config.json";

// Primitives — optional, may not exist if tokens haven't been exported from Figma.
// import.meta.glob returns {} if no files match (no error), unlike import() which
// Vite statically analyzes and fails on missing files.
const primitivesModules = import.meta.glob<{ default: Record<string, any> }>(
  "@project/src/tokens/primitives-font.*.tokens.json",
  { eager: true },
);

let primitives: Record<string, any> = {};
const entries = Object.values(primitivesModules);
if (entries.length > 0) {
  primitives = entries[0].default;
} else {
  console.warn(
    "No primitives-font tokens found in src/tokens/. " +
    "Token references like {font-size-1200} won't resolve. " +
    "Use raw px values (e.g. \"48px\") or place token files first."
  );
}

const SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog";

// Palette for graph lines — distinct, accessible on dark background
const STYLE_COLORS = [
  "#a78bfa", // violet
  "#34d399", // emerald
  "#f472b6", // pink
  "#fbbf24", // amber
  "#60a5fa", // blue
  "#f87171", // red
  "#2dd4bf", // teal
  "#fb923c", // orange
];

// ─── State ──────────────────────────────────────────────────────────

let currentConfig: FluidTypographyConfig = defaultConfig as FluidTypographyConfig;
let resolved: ResolvedFluidConfig | null = null;
let viewportWidth = 960;
let parseError: string | null = null;

function tryResolve(): void {
  try {
    const lookup = buildTokenLookup(primitives);
    resolved = resolveConfig(currentConfig, lookup);
    parseError = null;
  } catch (e: any) {
    resolved = null;
    parseError = e.message;
  }
}

// ─── Graph ──────────────────────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

function renderGraph(): void {
  const container = document.getElementById("graph-container")!;
  const legend = document.getElementById("graph-legend")!;
  container.innerHTML = "";
  legend.innerHTML = "";

  if (!resolved || Object.keys(resolved.styles).length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.75rem;">No styles to graph</div>';
    return;
  }

  const styleEntries = Object.entries(resolved.styles);
  const vwMin = resolved.viewports.min;
  const vwMax = resolved.viewports.max;

  // Find the y-axis range across all styles
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [, style] of styleEntries) {
    yMin = Math.min(yMin, style.fontSize.minPx);
    yMax = Math.max(yMax, style.fontSize.maxPx);
  }
  // Add padding
  const yPad = (yMax - yMin) * 0.15 || 4;
  yMin = Math.max(0, yMin - yPad);
  yMax = yMax + yPad;

  // SVG dimensions
  const W = 320;
  const H = 140;
  const pad = { top: 12, right: 12, bottom: 22, left: 32 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const toX = (vw: number) => pad.left + ((vw - vwMin) / (vwMax - vwMin)) * plotW;
  const toY = (px: number) => pad.top + plotH - ((px - yMin) / (yMax - yMin)) * plotH;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Grid lines (horizontal)
  const yTicks = niceSteps(yMin, yMax, 4);
  for (const tick of yTicks) {
    const y = toY(tick);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(pad.left));
    line.setAttribute("x2", String(W - pad.right));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "#27272a");
    line.setAttribute("stroke-width", "0.5");
    svg.appendChild(line);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", String(pad.left - 4));
    label.setAttribute("y", String(y + 3));
    label.setAttribute("text-anchor", "end");
    label.setAttribute("fill", "#52525b");
    label.setAttribute("font-size", "8");
    label.setAttribute("font-family", "var(--font-mono)");
    label.textContent = `${Math.round(tick)}`;
    svg.appendChild(label);
  }

  // X-axis labels
  const xLabels = [vwMin, Math.round((vwMin + vwMax) / 2), vwMax];
  for (const vw of xLabels) {
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", String(toX(vw)));
    label.setAttribute("y", String(H - 3));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "#52525b");
    label.setAttribute("font-size", "8");
    label.setAttribute("font-family", "var(--font-mono)");
    label.textContent = `${vw}`;
    svg.appendChild(label);
  }

  // Slope lines per style
  styleEntries.forEach(([name, style], i) => {
    const color = STYLE_COLORS[i % STYLE_COLORS.length];

    // Flat segments outside the viewport range
    const points = [
      // Left flat
      `${toX(vwMin)},${toY(style.fontSize.minPx)}`,
      // Right end of slope
      `${toX(vwMax)},${toY(style.fontSize.maxPx)}`,
    ];

    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", points.join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("stroke-linecap", "round");
    svg.appendChild(line);

    // Min/max dots
    for (const [vw, px] of [[vwMin, style.fontSize.minPx], [vwMax, style.fontSize.maxPx]] as const) {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(toX(vw)));
      dot.setAttribute("cy", String(toY(px)));
      dot.setAttribute("r", "2.5");
      dot.setAttribute("fill", color);
      svg.appendChild(dot);
    }

    // Legend entry
    const item = document.createElement("div");
    item.className = "graph-legend-item";
    item.innerHTML = `<span class="graph-legend-swatch" style="background:${color}"></span><span class="graph-legend-label">${name}</span>`;
    legend.appendChild(item);
  });

  // Viewport indicator (vertical line)
  const vwX = toX(viewportWidth);
  const indicator = document.createElementNS(SVG_NS, "line");
  indicator.setAttribute("x1", String(vwX));
  indicator.setAttribute("x2", String(vwX));
  indicator.setAttribute("y1", String(pad.top));
  indicator.setAttribute("y2", String(pad.top + plotH));
  indicator.setAttribute("stroke", "#fafafa");
  indicator.setAttribute("stroke-width", "1");
  indicator.setAttribute("stroke-dasharray", "3,3");
  indicator.setAttribute("opacity", "0.4");
  svg.appendChild(indicator);

  // Dots on the indicator line per style
  styleEntries.forEach(([, style], i) => {
    const color = STYLE_COLORS[i % STYLE_COLORS.length];
    const px = interpolateAtViewport(
      style.fontSize.minPx,
      style.fontSize.maxPx,
      style.viewports.min,
      style.viewports.max,
      viewportWidth,
    );
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(vwX));
    dot.setAttribute("cy", String(toY(px)));
    dot.setAttribute("r", "3.5");
    dot.setAttribute("fill", color);
    dot.setAttribute("stroke", "#0e0e10");
    dot.setAttribute("stroke-width", "1.5");
    svg.appendChild(dot);
  });

  container.appendChild(svg);
}

/** Generate nice round tick values for an axis. */
function niceSteps(min: number, max: number, count: number): number[] {
  const range = max - min;
  const rough = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const nice = rough / mag >= 5 ? 10 * mag : rough / mag >= 2 ? 5 * mag : 2 * mag;

  const ticks: number[] = [];
  let tick = Math.ceil(min / nice) * nice;
  while (tick <= max) {
    ticks.push(tick);
    tick += nice;
  }
  return ticks;
}

// ─── Render ─────────────────────────────────────────────────────────

function render(): void {
  // Viewport scrubber
  const scrubber = document.getElementById("viewport-scrubber") as HTMLInputElement;
  const vpLabel = document.getElementById("viewport-label")!;
  scrubber.min = String(currentConfig.viewports.min);
  scrubber.max = String(currentConfig.viewports.max);
  scrubber.value = String(viewportWidth);
  vpLabel.textContent = `${viewportWidth}px`;

  // Error display
  const errorEl = document.getElementById("error-display")!;
  if (parseError) {
    errorEl.textContent = parseError;
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
  }

  // Specimen
  const specimen = document.getElementById("specimen")!;
  specimen.innerHTML = "";

  if (!resolved) {
    renderGraph();
    return;
  }

  // Clamp output
  const clampOutput: string[] = [];

  for (const [styleName, style] of Object.entries(resolved.styles)) {
    const block = document.createElement("div");
    block.className = "specimen-block";

    // Style label
    const label = document.createElement("div");
    label.className = "specimen-label";
    label.textContent = styleName;
    block.appendChild(label);

    // Sample text
    const text = document.createElement("div");
    text.className = "specimen-text";
    text.textContent = SAMPLE_TEXT;

    const computedFontSize = interpolateAtViewport(
      style.fontSize.minPx,
      style.fontSize.maxPx,
      style.viewports.min,
      style.viewports.max,
      viewportWidth,
    );
    text.style.fontSize = `${computedFontSize}px`;

    if (style.fontFamily) {
      text.style.fontFamily = style.fontFamily;
    }

    if (style.lineHeight !== undefined) {
      if (typeof style.lineHeight === "number") {
        text.style.lineHeight = String(style.lineHeight);
      } else {
        const computedLh = interpolateAtViewport(
          style.lineHeight.min,
          style.lineHeight.max,
          style.viewports.min,
          style.viewports.max,
          viewportWidth,
        );
        text.style.lineHeight = String(Math.round(computedLh * 1000) / 1000);
      }
    }

    block.appendChild(text);

    // Size info
    const info = document.createElement("div");
    info.className = "specimen-info";
    info.textContent = `${Math.round(computedFontSize)}px at ${viewportWidth}px viewport (${style.fontSize.minPx}px \u2192 ${style.fontSize.maxPx}px)`;
    block.appendChild(info);

    specimen.appendChild(block);

    // Build clamp output
    const fsClamp = generateClamp({
      minPx: style.fontSize.minPx,
      maxPx: style.fontSize.maxPx,
      minVwPx: style.viewports.min,
      maxVwPx: style.viewports.max,
      baseFontSize: resolved.baseFontSize,
    });

    let mixin = `@mixin ${styleName} {\n  font-size: ${fsClamp};`;
    if (style.lineHeight !== undefined) {
      if (typeof style.lineHeight === "number") {
        mixin += `\n  line-height: ${style.lineHeight};`;
      } else {
        const lhClamp = generateUnitlessClamp({
          min: style.lineHeight.min,
          max: style.lineHeight.max,
          minVwPx: style.viewports.min,
          maxVwPx: style.viewports.max,
        });
        mixin += `\n  line-height: ${lhClamp};`;
      }
    }
    mixin += "\n}";
    clampOutput.push(mixin);
  }

  // Render clamp output
  const outputEl = document.getElementById("clamp-output")!;
  outputEl.textContent = clampOutput.join("\n\n");

  // Render graph
  renderGraph();
}

// ─── Event Handlers ─────────────────────────────────────────────────

function setupEvents(): void {
  const scrubber = document.getElementById("viewport-scrubber") as HTMLInputElement;
  scrubber.addEventListener("input", () => {
    viewportWidth = parseInt(scrubber.value, 10);
    render();
  });

  const editor = document.getElementById("config-editor") as HTMLTextAreaElement;
  editor.value = JSON.stringify(currentConfig, null, 2);
  editor.addEventListener("input", () => {
    try {
      currentConfig = JSON.parse(editor.value);
      tryResolve();
    } catch (e: any) {
      parseError = `Invalid JSON: ${e.message}`;
      resolved = null;
    }
    render();
  });

  const resetBtn = document.getElementById("reset-btn")!;
  resetBtn.addEventListener("click", (e) => {
    e.preventDefault(); // Prevent details toggle
    currentConfig = defaultConfig as FluidTypographyConfig;
    editor.value = JSON.stringify(currentConfig, null, 2);
    tryResolve();
    render();
  });

  const copyBtn = document.getElementById("copy-btn")!;
  copyBtn.addEventListener("click", (e) => {
    e.preventDefault(); // Prevent details toggle
    const output = document.getElementById("clamp-output")!.textContent ?? "";
    navigator.clipboard.writeText(output).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy SCSS"), 1500);
    });
  });
}

// ─── Init ───────────────────────────────────────────────────────────

tryResolve();
setupEvents();
render();
