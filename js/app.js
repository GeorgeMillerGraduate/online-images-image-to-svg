"use strict";
const $ = (id) => document.getElementById(id),
  source = $("sourceCanvas");
const presets = {
  compact: {
    colors: 8,
    speckle: 24,
    smooth: 7,
    resolution: 480,
    precision: 0,
    corner: 80,
  },
  balanced: {
    colors: 16,
    speckle: 12,
    smooth: 4,
    resolution: 640,
    precision: 1,
    corner: 60,
  },
  detailed: {
    colors: 32,
    speckle: 4,
    smooth: 2,
    resolution: 960,
    precision: 2,
    corner: 45,
  },
};
const modeNotes = {
  color:
    "Trace your image into filled shapes and smooth curves, with a limited palette to keep the file manageable.",
  bw: "Trace dark areas into black shapes. White areas stay transparent, making this useful for logos and scanned drawings.",
  pixel:
    "Trace pixel boundaries as straight edges. Use a low resolution and a small palette to keep pixel-art SVGs compact.",
};
let image,
  mode = "color",
  worker,
  job = 0,
  loadJob = 0,
  busy = false,
  ready = false,
  svgText = "",
  resultDoc,
  svgURL,
  detailURL,
  view = "side",
  filename = "Kingfisher sample",
  sourceBytes = 0,
  lastWidth = 0,
  lastHeight = 0;
function status(s) {
  $("status").textContent = s;
}
function options() {
  return {
    mode,
    colors: +$("colors").value,
    speckle: +$("speckle").value,
    smooth: +$("smooth").value,
    corner: +$("corner").value,
    threshold: +$("threshold").value,
    precision: +$("precision").value,
    curve: $("curve").value,
    transparent: $("transparent").checked,
  };
}
function controls() {
  $("traceButton").disabled = !image || busy;
  $("cancelButton").hidden = !busy;
  $("downloadButton").setAttribute("aria-disabled", String(!ready || busy));
  if (ready && !busy) {
    $("downloadButton").href = svgURL;
    $("downloadButton").download = "jenga-vector-" + mode + ".svg";
  } else $("downloadButton").removeAttribute("href");
  $("smallerButton").disabled = !image || busy;
  document.body.classList.toggle("processing", busy);
  for (const b of document.querySelectorAll("[data-view]")) b.disabled = !ready;
}
function labels() {
  for (const [id, unit] of [
    ["colors", ""],
    ["speckle", " px²"],
    ["smooth", " px"],
    ["corner", "°"],
    ["threshold", ""],
  ])
    $(id + "Value").textContent = $(id).value + unit;
  $("coloursLabel").hidden = mode === "bw";
  $("thresholdLabel").hidden = mode !== "bw";
  $("smoothLabel").hidden = $("cornerLabel").hidden = mode === "pixel";
  $("curve").disabled = mode === "pixel";
  $("transparent").disabled = mode === "bw";
  $("modeNote").textContent = modeNotes[mode];
  for (const b of document.querySelectorAll("[data-mode]"))
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
}
function invalidate(
  message = "Settings changed. Trace again to update the SVG.",
) {
  job++;
  worker?.terminate();
  worker = null;
  busy = false;
  ready = false;
  $("resultName").textContent = "Settings changed · trace to update";
  status(message);
  controls();
}
function usePreset(name) {
  const p = presets[name];
  if (!p) return;
  for (const [id, v] of Object.entries(p)) $(id).value = v;
  $("preset").value = name;
  labels();
}
function raster() {
  const cap = +$("resolution").value,
    scale = Math.min(
      1,
      cap / Math.max(image.naturalWidth, image.naturalHeight),
    );
  source.width = lastWidth = Math.max(
    1,
    Math.round(image.naturalWidth * scale),
  );
  source.height = lastHeight = Math.max(
    1,
    Math.round(image.naturalHeight * scale),
  );
  const ctx = source.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, source.width, source.height);
  ctx.drawImage(image, 0, 0, source.width, source.height);
  document.documentElement.style.setProperty(
    "--image-ratio",
    source.width + "/" + source.height,
  );
  $("sourceName").textContent =
    `${filename} · ${source.width} × ${source.height} tracing pixels`;
  return ctx.getImageData(0, 0, source.width, source.height);
}
function bytes(n) {
  return n < 1000
    ? n + " B"
    : n < 1e6
      ? (n / 1000).toFixed(1) + " KB"
      : (n / 1e6).toFixed(2) + " MB";
}
function validate(s) {
  const d = new DOMParser().parseFromString(s, "image/svg+xml");
  if (
    d.querySelector("parsererror") ||
    d.documentElement.localName !== "svg" ||
    d.querySelector("image,script,foreignObject,use")
  )
    throw Error("Unexpected SVG content.");
  for (const e of d.querySelectorAll("*"))
    for (const a of e.attributes)
      if (/^on/i.test(a.name) || /href/i.test(a.name) || /url\(/i.test(a.value))
        throw Error("Unexpected external content.");
  return d.documentElement;
}
function revoke() {
  if (svgURL) URL.revokeObjectURL(svgURL);
  if (detailURL) URL.revokeObjectURL(detailURL);
}
function display(s, r) {
  const doc = validate(s);
  resultDoc = doc;
  svgText = s;
  revoke();
  svgURL = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
  $("vectorImage").src = $("compareOutput").src = svgURL;
  $("vectorImage").hidden = false;
  $("vectorPlaceholder").hidden = true;
  $("pathInspector").replaceChildren(document.importNode(doc, true));
  const cc = $("compareOriginal");
  cc.width = source.width;
  cc.height = source.height;
  cc.getContext("2d").drawImage(source, 0, 0);
  details(doc);
  setCompare();
  $("colourCount").textContent = r.colors;
  $("pathCount").textContent = r.paths.toLocaleString();
  $("fileSize").textContent = bytes(r.bytes);
  $("traceTime").textContent = (r.ms / 1000).toFixed(2) + " s";
  const saving = r.rawBytes
    ? Math.max(0, Math.round((1 - r.bytes / r.rawBytes) * 100))
    : 0;
  $("sizeNote").textContent =
    `Pure vector · ${saving}% smaller after SVG cleanup${sourceBytes ? " · source file " + bytes(sourceBytes) : ""}. Fewer colours and lower resolution can reduce it further.`;
  $("resultName").textContent =
    `${r.paths} paths · ${bytes(r.bytes)} · ${lastWidth} × ${lastHeight} viewBox`;
  ready = true;
  setView(view);
  status(
    r.paths
      ? "Trace ready. Download the SVG or inspect the paths."
      : "No visible paths at these settings. Try reducing speckle removal or adjusting the threshold.",
  );
}
function details(doc) {
  const w = source.width,
    h = source.height,
    cw = Math.max(1, w * 0.25),
    ch = Math.max(1, cw * 0.48),
    x = Math.max(0, (w - cw) / 2),
    y = Math.max(0, Math.min(h - ch, h * 0.46 - ch / 2)),
    c = $("bitmapDetail"),
    ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, x, y, cw, ch, 0, 0, c.width, c.height);
  const copy = doc.cloneNode(true),
    vb = doc.getAttribute("viewBox").split(/[ ,]+/).map(Number);
  copy.setAttribute("viewBox", `${vb[0] + x} ${vb[1] + y} ${cw} ${ch}`);
  copy.setAttribute("width", "100%");
  copy.setAttribute("height", "100%");
  copy.setAttribute("preserveAspectRatio", "none");
  $("vectorDetail").replaceChildren(document.importNode(copy, true));
}
function setView(v) {
  view = v;
  for (const b of document.querySelectorAll("[data-view]"))
    b.setAttribute("aria-pressed", String(b.dataset.view === v));
  $("workspace").hidden = v === "compare";
  $("comparison").hidden = v !== "compare";
  $("workspace").classList.toggle("inspect", v === "paths");
  $("pathInspector").hidden = v !== "paths";
  $("vectorImage").hidden = v === "paths" || !svgText;
}
function setCompare() {
  const n = $("compareRange").value;
  $("compareOutput").style.clipPath = `inset(0 0 0 ${n}%)`;
  $("divider").style.left = `${n}%`;
}
function trace() {
  if (!image) return;
  worker?.terminate();
  const id = ++job,
    data = raster(),
    o = options();
  busy = true;
  ready = false;
  controls();
  status("Starting the local tracing engine…");
  $("resultName").textContent = "Tracing…";
  try {
    worker = new Worker("js/worker.js", { type: "module" });
    worker.onerror = () => {
      if (id !== job) return;
      busy = false;
      controls();
      status(
        "The tracing engine could not start. Serve this folder over HTTP/HTTPS and include js/vendor/vtracer.wasm.",
      );
    };
    worker.onmessage = (e) => {
      const r = e.data;
      if (r.id !== job) return;
      if (r.stage) {
        status(r.stage);
        return;
      }
      busy = false;
      if (r.error) {
        status(r.error);
        controls();
        return;
      }
      try {
        display(r.svg, r);
      } catch (error) {
        status("Could not display the trace: " + error.message);
      }
      controls();
      worker.terminate();
      worker = null;
    };
    worker.postMessage(
      {
        id,
        data: data.data.buffer,
        width: data.width,
        height: data.height,
        options: o,
      },
      [data.data.buffer],
    );
  } catch (error) {
    busy = false;
    controls();
    status("Could not start tracing: " + error.message);
  }
}
async function load(src, name, size = 0) {
  const id = ++loadJob;
  job++;
  worker?.terminate();
  worker = null;
  busy = true;
  ready = false;
  controls();
  status("Loading the source image…");
  try {
    const im = new Image();
    im.src = src;
    await im.decode();
    if (id !== loadJob) return;
    if (im.naturalWidth * im.naturalHeight > 40e6)
      throw Error("Choose an image under 40 megapixels.");
    image = im;
    filename = name;
    sourceBytes = size;
    trace();
  } catch (error) {
    if (id !== loadJob) return;
    busy = false;
    status("Could not load image. " + error.message);
    controls();
  }
}
for (const b of document.querySelectorAll("[data-mode]"))
  b.onclick = () => {
    mode = b.dataset.mode;
    labels();
    trace();
  };
for (const id of ["colors", "speckle", "smooth", "corner", "threshold"])
  $(id).oninput = () => {
    $("preset").value = "custom";
    labels();
    invalidate();
  };
for (const id of ["resolution", "curve", "precision", "transparent"])
  $(id).onchange = () => {
    $("preset").value = "custom";
    invalidate();
  };
$("preset").onchange = () => {
  if ($("preset").value === "custom") return;
  usePreset($("preset").value);
  invalidate();
};
$("traceButton").onclick = trace;
$("cancelButton").onclick = () => {loadJob++;invalidate("Tracing cancelled. Change settings or trace again.");};
$("smallerButton").onclick = () => {
  usePreset("compact");
  trace();
};
$("resetButton").onclick = () => {
  usePreset("balanced");
  $("curve").value = "spline";
  $("transparent").checked = true;
  $("threshold").value = 128;
  labels();
  trace();
};
for (const b of document.querySelectorAll("[data-view]"))
  b.onclick = () => setView(b.dataset.view);
$("compareRange").oninput = setCompare;
$("downloadButton").onclick = (event) => {
  if (!ready || busy) {
    event.preventDefault();
    return;
  }
  status("SVG prepared for download. It contains vector shapes only.");
};
$("uploadButton").onclick = () => $("imageInput").click();
$("imageInput").onchange = async () => {
  const f = $("imageInput").files[0];
  if (!f) return;
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
    f.size > 20 * 1024 * 1024
  ) {
    status("Choose a PNG, JPEG or WebP smaller than 20 MB.");
    return;
  }
  const url = URL.createObjectURL(f);
  await load(url, f.name, f.size);
  URL.revokeObjectURL(url);
  $("imageInput").value = "";
};
$("sampleButton").onclick = () =>
  load(
    "images/kingfisher-sample.webp",
    "Kingfisher sample · generated for Jenga-Code",
  );
labels();
controls();
load(
  "images/kingfisher-sample.webp",
  "Kingfisher sample · generated for Jenga-Code",
);
