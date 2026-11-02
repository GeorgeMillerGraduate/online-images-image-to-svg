import init, { to_svg } from "./vendor/vtracer.js";
import { optimise } from "./vendor/optimizer.js";
import "./preprocess.js";
const ready = init({
  module_or_path: new URL("./vendor/vtracer.wasm", import.meta.url),
});
self.onmessage = async (e) => {
  const { id, width, height, options } = e.data;
  try {
    await ready;
    const start = performance.now();
    self.postMessage({
      id,
      stage: "Reducing colours and removing unnecessary detail…",
    });
    const prepared = self.TracePrep.prepare(
      new Uint8ClampedArray(e.data.data),
      width,
      height,
      options,
    );
    self.postMessage({
      id,
      stage: "Tracing filled regions and fitting curves…",
    });
    let raw = prepared.empty
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`
      : to_svg(prepared.data, prepared.width, prepared.height, {
          binary: options.mode === "bw",
          mode: options.mode === "pixel" ? "pixel" : options.curve,
          hierarchical: "stacked",
          cornerThreshold: (options.corner * Math.PI) / 180,
          lengthThreshold: options.smooth,
          maxIterations: 10,
          spliceThreshold: (45 * Math.PI) / 180,
          filterSpeckle: options.speckle,
          colorPrecision: 0,
          layerDifference: 16,
          pathPrecision: options.precision,
        });
    raw = raw.replace(
      /<svg\b([^>]*)>/,
      (_, attrs) =>
        `<svg${attrs.replace(/\s(?:width|height|viewBox)="[^"]*"/g, "")} width="${width}" height="${height}" viewBox="${prepared.viewBox}">`,
    );
    raw = self.TracePrep.snapFills(raw, prepared.palette);
    const usedColors = new Set(
      [...raw.matchAll(/\bfill="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((c) => c !== "none"),
    );
    const rawBytes = new TextEncoder().encode(raw).length;
    self.postMessage({
      id,
      stage: "Simplifying paths and optimising SVG markup…",
    });
    let svg = optimise(raw, options.precision);
    if (new TextEncoder().encode(svg).length > rawBytes) svg = raw;
    const bytes = new TextEncoder().encode(svg).length;
    if (/<image\b|data:image/i.test(svg))
      throw Error("Unexpected embedded image in vector output.");
    self.postMessage({
      id,
      svg,
      rawBytes,
      bytes,
      ms: performance.now() - start,
      paths: (svg.match(/<path\b/g) || []).length,
      colors: usedColors.size,
    });
  } catch (error) {
    self.postMessage({ id, error: "Tracing failed: " + error.message });
  }
};
