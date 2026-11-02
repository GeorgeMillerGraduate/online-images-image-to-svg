Jenga-Code / PNG to SVG

INSTALL
Extract the CONTENTS of this ZIP into public_html/apps/image-to-svg/, replacing index.html, css/ and js/ and adding images/. Keep js/vendor/vtracer.wasm and all vendor JS files. Hard refresh Chrome with Ctrl+F5. Run over HTTP or HTTPS, not by double-clicking index.html. No server API, GPU, npm installation or account is needed by visitors. The browser must support WebAssembly and module workers.

COMPACT SVG PIPELINE
1. Resize the working raster, never upscale it.
2. Quantise colours with weighted histogram median-cut and cached palette lookup.
3. VTracer-WASM traces filled regions and fits curves, filtering small regions.
4. Snap output fills to the selected palette.
5. SVGO performs multipass path/markup cleanup with selected coordinate precision.
6. Keep whichever pure-vector markup is smaller.
No source raster or base64 image is embedded in exported SVGs.

Balanced defaults: 640px longest side, 16 colours, 12px² speckle filter, 4px segment length, one decimal coordinate precision.
Compact: 480px, 8 colours, 24px² speckle, 7px segments, integer coordinates.
Detailed: 960px, 32 colours, 4px² speckle, 2px segments, two decimals.
Controls can be changed independently. Try a smaller file selects Compact and retraces; it is a preset, not a guaranteed byte budget. File size depends on the image. Pixel art often needs a much lower resolution than other modes.

FEATURES
Colour, black-and-white and pixel-art modes; before/after slider; vector-path inspection; genuine paired zoom crops; actual SVG byte size, path count, colour count and worker time; SVG download; cancellation; local PNG/JPEG/WebP upload up to 20MB/40MP. White regions in black-and-white mode are transparent. Partial alpha handling is documented next to the advanced controls and in credits.

The main source preview is the unmodified source at tracing resolution, not the quantised input. The downloaded viewBox uses tracing coordinates; SVG still scales to other sizes. Display frames do not form part of the download. Inspect paths is a wireframe preview, not a vector editor. Changing settings disables download until you retrace.

MEASURED COMPARISON
A 640x427 RGBA raster of the bundled kingfisher was supplied to both old and new pipelines in a local test. The original converter used its shipped defaults (Canny .10/.30, blur on, threshold128, contour limit10000, sampling8), with a PNG of that same raster embedded as the original code does.
Original: 905,639 bytes, 1,806 paths, embedded raster present.
New Balanced on identical raster: 178,074 bytes (about 80% smaller), pure vector.
New Compact-like tracing settings on the SAME 640x427 raster: 56,840 bytes (about 94% smaller than the old output). The UI Compact preset additionally resizes to480px and produced40.1KB in the browser test. Differences in resampling affect exact sizes. These are sample-specific results, not universal promises. Removing the raster and reducing detail change fidelity; this is not a lossless comparison.

LIBRARIES
vtracer-wasm0.1.0 (MIT), VisionCortex0.8.1 (MIT option), SVGO4.0.0 (MIT). This browser engine is not VTracer1.0 alpha. Licences and attribution notices included.

VERIFICATION LIMIT
The automated Chrome environment displayed all generated SVGs and validated the download link, but its download-event capture timed out for SVG files. SVG generation, local file serialization, size checks, transparent-hole rendering and palette bounds passed. Confirm the download in your own Chrome after upload.
