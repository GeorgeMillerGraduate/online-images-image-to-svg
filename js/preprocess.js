/* Local palette reduction for compact tracing. MIT, George Miller 2026. */
(function (root) {
  "use strict";
  function prepare(rgba, w, h, opt) {
    const transparency = opt.mode !== "bw" && opt.transparent,
      src = new Uint8Array(rgba.length),
      hist = new Map();
    for (let p = 0; p < w * h; p++) {
      const i = p * 4,
        a = rgba[i + 3] / 255;
      if (transparency && a < 0.5) {
        src[i + 3] = 0;
        continue;
      }
      const rgb = [0, 1, 2].map((c) =>
        Math.round(rgba[i + c] * a + 255 * (1 - a)),
      );
      if (opt.mode === "bw") {
        const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2],
          v = y < (opt.threshold ?? 128) ? 0 : 255;
        src.set([v, v, v, 255], i);
        continue;
      }
      src.set([...rgb, 255], i);
      const key = ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3);
      let b = hist.get(key);
      if (!b) {
        b = { key, n: 0, sum: [0, 0, 0], rgb: [0, 0, 0] };
        hist.set(key, b);
      }
      b.n++;
      for (let c = 0; c < 3; c++) b.sum[c] += rgb[c];
    }
    if (opt.mode === "bw")
      return {
        data: src,
        width: w,
        height: h,
        viewBox: `0 0 ${w} ${h}`,
        palette: [[0, 0, 0]],
        empty: false,
      };
    const bins = [...hist.values()];
    if (!bins.length)
      return {
        data: src,
        width: w,
        height: h,
        viewBox: `0 0 ${w} ${h}`,
        palette: [],
        empty: true,
      };
    for (const b of bins) b.rgb = b.sum.map((v) => v / b.n);
    const describe = (list) => {
      const lo = [255, 255, 255],
        hi = [0, 0, 0];
      let n = 0;
      for (const b of list) {
        n += b.n;
        for (let c = 0; c < 3; c++) {
          lo[c] = Math.min(lo[c], b.rgb[c]);
          hi[c] = Math.max(hi[c], b.rgb[c]);
        }
      }
      const range = hi.map((v, c) => v - lo[c]),
        axis = range.indexOf(Math.max(...range));
      return { list, n, axis, score: range[axis] * Math.sqrt(n) };
    };
    const boxes = [describe(bins)];
    while (boxes.length < opt.colors) {
      let ix = -1;
      for (let i = 0; i < boxes.length; i++)
        if (
          boxes[i].list.length > 1 &&
          (ix < 0 || boxes[i].score > boxes[ix].score)
        )
          ix = i;
      if (ix < 0) break;
      const box = boxes.splice(ix, 1)[0],
        list = box.list.sort((a, b) => a.rgb[box.axis] - b.rgb[box.axis]);
      let n = 0,
        split = 1;
      for (let i = 0; i < list.length - 1; i++) {
        n += list[i].n;
        split = i + 1;
        if (n >= box.n / 2) break;
      }
      boxes.push(describe(list.slice(0, split)), describe(list.slice(split)));
    }
    const palette = boxes.map((box) => {
        const sum = [0, 0, 0];
        for (const b of box.list)
          for (let c = 0; c < 3; c++) sum[c] += b.sum[c];
        return sum.map((v) => Math.round(v / box.n));
      }),
      lookup = new Map();
    for (const b of bins) {
      let best = 0,
        d = Infinity;
      palette.forEach((c, i) => {
        const e = c.reduce((s, v, j) => s + (v - b.rgb[j]) ** 2, 0);
        if (e < d) {
          d = e;
          best = i;
        }
      });
      lookup.set(b.key, palette[best]);
    }
    for (let i = 0; i < src.length; i += 4)
      if (src[i + 3]) {
        const key =
          ((src[i] >> 3) << 10) | ((src[i + 1] >> 3) << 5) | (src[i + 2] >> 3);
        src.set(lookup.get(key), i);
      }
    if (!transparency)
      return {
        data: src,
        width: w,
        height: h,
        viewBox: `0 0 ${w} ${h}`,
        palette,
        empty: false,
      };
    // A transparent one-pixel border reliably activates this engine's alpha keying.
    const padded = new Uint8Array((w + 2) * (h + 2) * 4);
    for (let y = 0; y < h; y++)
      padded.set(
        src.subarray(y * w * 4, (y + 1) * w * 4),
        ((y + 1) * (w + 2) + 1) * 4,
      );
    return {
      data: padded,
      width: w + 2,
      height: h + 2,
      viewBox: `1 1 ${w} ${h}`,
      palette,
      empty: false,
    };
  }
  function snapFills(svg, palette) {
    if (!palette.length) return svg;
    const cache = new Map();
    return svg.replace(/fill="(#[\da-f]{6})"/gi, (all, hex) => {
      if (!cache.has(hex)) {
        const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        let best = palette[0],
          d = Infinity;
        for (const c of palette) {
          const e = c.reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0);
          if (e < d) {
            d = e;
            best = c;
          }
        }
        cache.set(
          hex,
          "#" + best.map((v) => v.toString(16).padStart(2, "0")).join(""),
        );
      }
      return `fill="${cache.get(hex)}"`;
    });
  }
  const api = { prepare, snapFills };
  root.TracePrep = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
