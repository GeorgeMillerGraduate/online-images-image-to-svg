/**
 * Image to SVG Converter
 *
 * Supports:
 *
 *     PNG
 *     JPG
 *     JPEG
 *
 * Front-end application classes.
 *
 * Required scripts:
 *
 *     ImageHolder.js
 *     CannyEdgeDetector.js
 *     MarchingSquares.js
 *     BezierPathFitter.js
 *     EdgeToSVGColor.js
 *     script.js
 */


/* =========================================================
   IMAGE UPLOADER
   ========================================================= */

class ImageUploader {

    constructor() {

        this.fileInput =
            $("#fileInput");

        this.browseButton =
            $("#browseButton");

        this.uploadArea =
            $("#uploadArea");

        this.file =
            null;

        this.bindEvents();
    }


    bindEvents() {

        /*
         * Open the native file picker from the browse button.
         */
        this.browseButton.on(
            "click",
            (event) => {

                /*
                 * Prevent the click bubbling to the upload area
                 * and opening the picker twice.
                 */
                event.stopPropagation();

                this.fileInput.trigger(
                    "click"
                );
            }
        );


        /*
         * Allow clicking anywhere inside the upload area.
         */
        this.uploadArea.on(
            "click",
            (event) => {

                if (
                    event.target !== this.fileInput[0] &&
                    event.target !== this.browseButton[0]
                ) {

                    this.fileInput.trigger(
                        "click"
                    );
                }
            }
        );


        /*
         * Handle files selected through the file picker.
         */
        this.fileInput.on(
            "change",
            (event) => {

                const file =
                    event.target.files[0];

                if (file) {

                    this.processFile(
                        file
                    );
                }
            }
        );


        /*
         * Drag-and-drop handling.
         */
        this.uploadArea.on(
            "dragover",
            (event) => {

                event.preventDefault();

                this.uploadArea.addClass(
                    "dragging"
                );
            }
        );


        this.uploadArea.on(
            "dragleave",
            () => {

                this.uploadArea.removeClass(
                    "dragging"
                );
            }
        );


        this.uploadArea.on(
            "drop",
            (event) => {

                event.preventDefault();

                this.uploadArea.removeClass(
                    "dragging"
                );

                const files =
                    event.originalEvent
                        .dataTransfer
                        .files;

                if (
                    files &&
                    files.length > 0
                ) {

                    this.processFile(
                        files[0]
                    );
                }
            }
        );
    }


    /**
     * Validate and store a selected raster image.
     */
    processFile(file) {

        if (
            !this.isSupportedImage(file)
        ) {

            alert(
                "Please select a PNG, JPG or JPEG image."
            );

            /*
             * Clear an invalid file from the input so that
             * selecting the same file again still triggers change.
             */
            this.fileInput.val("");

            return;
        }


        this.file =
            file;


        $(document).trigger(
            "image:selected",
            [file]
        );
    }


    /**
     * Supported raster formats.
     *
     * MIME type is checked first, but the filename extension is
     * also checked because some browsers/environments may provide
     * an empty or unusual MIME type.
     */
    isSupportedImage(file) {

        if (!file) {

            return false;
        }


        const type =
            String(
                file.type || ""
            ).toLowerCase();


        const name =
            String(
                file.name || ""
            ).toLowerCase();


        return (
            type === "image/png" ||
            type === "image/jpeg" ||
            type === "image/jpg" ||
            name.endsWith(".png") ||
            name.endsWith(".jpg") ||
            name.endsWith(".jpeg")
        );
    }


    /**
     * Return the currently selected image.
     */
    getFile() {

        return this.file;
    }
}



/* =========================================================
   PREVIEW MANAGER
   ========================================================= */

class PreviewManager {

    constructor() {

        this.inputPreview =
            $("#inputPreview");

        this.outputPreview =
            $("#outputPreview");

        this.inputFileInfo =
            $("#inputFileInfo");

        this.outputFileInfo =
            $("#outputFileInfo");

        this.bindEvents();
    }


    bindEvents() {

        /*
         * Show a newly selected source image.
         */
        $(document).on(
            "image:selected",
            (event, file) => {

                this.showInputImage(
                    file
                );
            }
        );


        /*
         * Show the generated SVG.
         */
        $(document).on(
            "svg:created",
            (event, svgData) => {

                this.showSVG(
                    svgData
                );
            }
        );
    }


    /**
     * Display the selected PNG/JPEG.
     */
    showInputImage(file) {

        const reader =
            new FileReader();


        reader.onload =
            (event) => {

                const image =
                    $("<img>", {

                        src:
                            event.target.result,

                        alt:
                            file.name
                    });


                image.css({

                    "max-width":
                        "100%",

                    "max-height":
                        "340px",

                    "width":
                        "auto",

                    "height":
                        "auto",

                    "object-fit":
                        "contain"
                });


                this.inputPreview
                    .empty()
                    .append(
                        image
                    );
            };


        reader.onerror =
            () => {

                this.inputPreview.html(`

                    <span>ERR</span>

                    <p>
                        The image preview could not be loaded
                    </p>

                `);
            };


        reader.readAsDataURL(
            file
        );


        const format =
            this.getImageFormat(
                file
            );


        this.inputFileInfo.text(
            `${format} • ${this.formatFileSize(file.size)}`
        );


        this.clearOutput();
    }


    /**
     * Display generated SVG markup.
     */
    showSVG(svgData) {

        this.outputPreview
            .empty()
            .html(
                svgData
            );


        this.outputPreview
            .find("svg")
            .css({

                "max-width":
                    "100%",

                "max-height":
                    "340px",

                "width":
                    "auto",

                "height":
                    "auto"
            });


        const bytes =
            new Blob(
                [svgData]
            ).size;


        this.outputFileInfo.text(
            `SVG • ${this.formatFileSize(bytes)}`
        );
    }


    /**
     * Reset output preview whenever a new source image is chosen.
     */
    clearOutput() {

        this.outputPreview.html(`

            <span>SVG</span>

            <p>
                Your converted vector will appear here
            </p>

        `);


        this.outputFileInfo.text(
            "Waiting"
        );
    }


    /**
     * Return a short human-readable source format.
     */
    getImageFormat(file) {

        const name =
            String(
                file.name || ""
            ).toLowerCase();


        if (
            file.type === "image/png" ||
            name.endsWith(".png")
        ) {

            return "PNG";
        }


        if (
            file.type === "image/jpeg" ||
            file.type === "image/jpg" ||
            name.endsWith(".jpg") ||
            name.endsWith(".jpeg")
        ) {

            return "JPEG";
        }


        return "IMAGE";
    }


    /**
     * Convert bytes into a readable file size.
     */
    formatFileSize(bytes) {

        if (bytes < 1024) {

            return `${bytes} B`;
        }


        if (
            bytes < 1024 * 1024
        ) {

            return `${(
                bytes / 1024
            ).toFixed(1)} KB`;
        }


        return `${(
            bytes /
            (1024 * 1024)
        ).toFixed(1)} MB`;
    }
}



/* =========================================================
   CONVERSION SETTINGS
   ========================================================= */

class ConversionSettings {

    constructor() {

        this.edgeThreshold =
            $("#edgeThreshold");

        this.edgeThresholdValue =
            $("#edgeThresholdValue");


        this.colourSampling =
            $("#colourSampling");

        this.colourSamplingValue =
            $("#colourSamplingValue");


        this.contourDetail =
            $("#contourDetail");


        this.bindEvents();

        this.updateDisplays();
    }


    bindEvents() {

        this.edgeThreshold.on(
            "input change",
            () => {

                this.edgeThresholdValue.text(
                    this.edgeThreshold.val()
                );
            }
        );


        this.colourSampling.on(
            "input change",
            () => {

                this.colourSamplingValue.text(
                    this.colourSampling.val()
                );
            }
        );
    }


    updateDisplays() {

        this.edgeThresholdValue.text(
            this.edgeThreshold.val()
        );


        this.colourSamplingValue.text(
            this.colourSampling.val()
        );
    }


    /**
     * Return the current UI settings.
     */
    getSettings() {

        return {

            edgeThreshold:
                parseInt(
                    this.edgeThreshold.val(),
                    10
                ),

            colourSampling:
                parseInt(
                    this.colourSampling.val(),
                    10
                ),

            contourDetail:
                this.contourDetail.val()
        };
    }


    /**
     * Convert the UI detail selection into the contour point
     * limit used by the vectorisation pipeline.
     */
    getContourLimit() {

        const detail =
            String(
                this.contourDetail.val() || ""
            ).toLowerCase();


        switch (detail) {

            case "low":

                return 5000;


            case "medium":

                return 10000;


            case "high":

                return 20000;


            /*
             * The current HTML calls the highest setting
             * "maximum". Support the older "ultra" value too.
             */
            case "maximum":
            case "ultra":

                return 40000;


            default: {

                /*
                 * Also support numeric values if the HTML is
                 * changed to use actual contour limits.
                 */
                const numeric =
                    parseInt(
                        detail,
                        10
                    );


                if (
                    Number.isFinite(numeric) &&
                    numeric > 0
                ) {

                    return numeric;
                }


                return 20000;
            }
        }
    }
}



/* =========================================================
   STATUS MANAGER
   ========================================================= */

class StatusManager {

    constructor() {

        /*
         * New jenga-code HTML uses #converterStatus.
         *
         * Keep .status as a fallback so this script also works
         * with the older page while it is being replaced.
         */
        this.status =
            $("#converterStatus, .status");
    }


    setReady() {

        this.setStatus(
            "READY",
            "ready"
        );
    }


    setImageLoaded() {

        this.setStatus(
            "IMAGE LOADED",
            "loaded"
        );
    }


    setConverting() {

        this.setStatus(
            "CONVERTING...",
            "converting"
        );
    }


    setComplete() {

        this.setStatus(
            "COMPLETE",
            "complete"
        );
    }


    setError() {

        this.setStatus(
            "ERROR",
            "error"
        );
    }


    setStatus(
        text,
        state
    ) {

        this.status
            .text(text)
            .attr(
                "data-state",
                state
            );
    }
}



/* =========================================================
   DOWNLOAD MANAGER
   ========================================================= */

class DownloadManager {

    constructor() {

        this.downloadButton =
            $("#downloadButton");

        this.svgData =
            null;

        this.filename =
            "vector.svg";

        this.bindEvents();


        /*
         * Nothing can be downloaded until a conversion has
         * successfully completed.
         */
        this.downloadButton.prop(
            "disabled",
            true
        );
    }


    bindEvents() {

        /*
         * Store newly generated SVG data.
         */
        $(document).on(
            "svg:created",
            (
                event,
                svgData,
                filename
            ) => {

                this.svgData =
                    svgData;


                if (filename) {

                    this.filename =
                        filename;
                }


                this.downloadButton.prop(
                    "disabled",
                    false
                );
            }
        );


        /*
         * A new source image invalidates the previous SVG.
         */
        $(document).on(
            "image:selected",
            () => {

                this.reset();
            }
        );


        this.downloadButton.on(
            "click",
            () => {

                this.download();
            }
        );
    }


    /**
     * Download the generated SVG.
     */
    download() {

        if (!this.svgData) {

            return;
        }


        const blob =
            new Blob(
                [this.svgData],
                {
                    type:
                        "image/svg+xml;charset=utf-8"
                }
            );


        const url =
            URL.createObjectURL(
                blob
            );


        const link =
            document.createElement(
                "a"
            );


        link.href =
            url;

        link.download =
            this.filename;


        document.body.appendChild(
            link
        );


        link.click();

        link.remove();


        /*
         * Give the browser enough time to begin the download
         * before releasing the object URL.
         */
        window.setTimeout(
            () => {

                URL.revokeObjectURL(
                    url
                );
            },
            1000
        );
    }


    reset() {

        this.svgData =
            null;

        this.filename =
            "vector.svg";


        this.downloadButton.prop(
            "disabled",
            true
        );
    }
}



/* =========================================================
   SVG CONVERTER
   ========================================================= */

class SVGConverter {

    constructor(
        uploader,
        settings,
        statusManager
    ) {

        this.uploader =
            uploader;

        this.settings =
            settings;

        this.statusManager =
            statusManager;

        this.convertButton =
            $("#convertButton");

        this.converting =
            false;


        this.bindEvents();


        /*
         * There is no source image when the application starts.
         */
        this.convertButton.prop(
            "disabled",
            true
        );
    }


    bindEvents() {

        /*
         * Enable conversion once a valid image is loaded.
         */
        $(document).on(
            "image:selected",
            () => {

                this.convertButton.prop(
                    "disabled",
                    false
                );


                this.statusManager
                    .setImageLoaded();
            }
        );


        this.convertButton.on(
            "click",
            () => {

                this.convert();
            }
        );
    }


    /**
     * Run the complete raster image -> SVG pipeline.
     *
     * Supported source formats:
     *
     *     PNG
     *     JPG
     *     JPEG
     */
    async convert() {

        if (this.converting) {

            return;
        }


        const file =
            this.uploader.getFile();


        if (!file) {

            return;
        }


        const settings =
            this.settings.getSettings();


        const contourLimit =
            this.settings.getContourLimit();


        console.log(
            "Source image selected:",
            file
        );


        console.log(
            "Source format:",
            file.type || "unknown"
        );


        console.log(
            "Conversion settings:",
            settings
        );


        console.log(
            "Contour point limit:",
            contourLimit
        );


        this.converting =
            true;


        this.convertButton.prop(
            "disabled",
            true
        );


        this.statusManager
            .setConverting();


        /*
         * Give the browser an opportunity to paint the
         * CONVERTING state before CPU-heavy work begins.
         */
        await new Promise(
            resolve =>
                window.setTimeout(
                    resolve,
                    20
                )
        );


        try {

            /*
             * -------------------------------------------------
             * 1. Raster file -> ImageHolder
             * -------------------------------------------------
             *
             * ImageHolder.fromFile() uses the browser's image
             * decoder, so the rest of the vectorisation pipeline
             * receives image pixels regardless of whether the
             * original file was PNG or JPEG.
             */
            const original =
                await ImageHolder.fromFile(
                    file
                );


            if (!original) {

                throw new Error(
                    "The source image could not be decoded."
                );
            }


            console.log(
                "Image loaded:",
                original.getWidth(),
                "x",
                original.getHeight()
            );


            /*
             * -------------------------------------------------
             * 2. Preserve original raster as a data URL
             * -------------------------------------------------
             *
             * EdgeToSVGColor can optionally embed the original
             * raster underneath the generated vector paths.
             *
             * Blob -> data URL works for both PNG and JPEG.
             */
            let rasterDataUrl =
                null;


            if (
                EdgeToSVGColor.INCLUDE_RASTER_BASE
            ) {

                rasterDataUrl =
                    await EdgeToSVGColor.blobToDataUrl(
                        file
                    );
            }


            /*
             * -------------------------------------------------
             * 3. Canny detector parameters
             * -------------------------------------------------
             */

            const lowThreshold =
                0.10;


            const highThreshold =
                0.30;


            /*
             * Gaussian blur is useful for both formats and is
             * particularly helpful for JPEG input because JPEG
             * compression can introduce small edge artefacts.
             */
            const gaussianBlur =
                true;


            /*
             * UI edge threshold.
             *
             * This is ultimately used by Marching Squares.
             */
            const edgeThreshold =
                this.normaliseEdgeThreshold(
                    settings.edgeThreshold
                );


            /*
             * Colour sampling interval.
             *
             * Smaller values sample the source image more often,
             * improving colour accuracy at increased cost.
             */
            const colourSampleStep =
                this.normaliseColourSampling(
                    settings.colourSampling
                );


            console.log(
                "Edge threshold:",
                edgeThreshold
            );


            console.log(
                "Colour sample step:",
                colourSampleStep
            );


            /*
             * -------------------------------------------------
             * 4. Complete vectorisation
             * -------------------------------------------------
             *
             * Pipeline:
             *
             * Raster Image
             *      ↓
             * ImageHolder
             *      ↓
             * CannyEdgeDetector
             *      ↓
             * MarchingSquares
             *      ↓
             * RDP simplification
             *      ↓
             * BezierPathFitter
             *      ↓
             * Colour sampling
             *      ↓
             * SVG XML
             */
            const svgData =
                EdgeToSVGColor
                    .convertImageToColorEdgeSvg(

                        original,

                        lowThreshold,

                        highThreshold,

                        gaussianBlur,

                        edgeThreshold,

                        contourLimit,

                        colourSampleStep,

                        rasterDataUrl
                    );


            /*
             * -------------------------------------------------
             * 5. Validate generated SVG
             * -------------------------------------------------
             */

            if (
                !svgData ||
                typeof svgData !== "string"
            ) {

                throw new Error(
                    "The converter did not produce SVG data."
                );
            }


            if (
                !svgData.includes(
                    "<svg"
                )
            ) {

                throw new Error(
                    "Generated output is not valid SVG markup."
                );
            }


            /*
             * -------------------------------------------------
             * 6. Create output filename
             * -------------------------------------------------
             */

            const filename =
                this.createOutputFilename(
                    file.name
                );


            /*
             * -------------------------------------------------
             * 7. Notify preview and download managers
             * -------------------------------------------------
             */

            $(document).trigger(
                "svg:created",
                [
                    svgData,
                    filename
                ]
            );


            this.statusManager
                .setComplete();


            console.log(
                "Image -> SVG conversion complete."
            );


            console.log(
                "Generated SVG characters:",
                svgData.length
            );

        } catch (error) {

            console.error(
                "Image -> SVG conversion failed:",
                error
            );


            this.statusManager
                .setError();


            alert(
                "The image could not be converted to SVG.\n\n" +
                (
                    error &&
                    error.message
                        ? error.message
                        : String(error)
                )
            );

        } finally {

            this.converting =
                false;


            /*
             * Re-enable conversion if a valid image remains
             * selected.
             */
            this.convertButton.prop(
                "disabled",
                !this.uploader.getFile()
            );
        }
    }


    /**
     * Keep the Marching Squares threshold inside the expected
     * luminance range of 0-255.
     */
    normaliseEdgeThreshold(value) {

        let threshold =
            Number(
                value
            );


        if (
            !Number.isFinite(
                threshold
            )
        ) {

            threshold =
                128;
        }


        return Math.max(
            0,
            Math.min(
                255,
                threshold
            )
        );
    }


    /**
     * Convert the colour-quality control into the sampling step
     * expected by EdgeToSVGColor.
     */
    normaliseColourSampling(value) {

        let step =
            Number(
                value
            );


        if (
            !Number.isFinite(
                step
            )
        ) {

            step =
                8;
        }


        step =
            Math.round(
                step
            );


        return Math.max(
            1,
            step
        );
    }


    /**
     * Replace the source raster extension with .svg.
     *
     * Examples:
     *
     *     cat.png        -> cat.svg
     *     photo.jpg      -> photo.svg
     *     landscape.jpeg -> landscape.svg
     */
    createOutputFilename(
        inputFilename
    ) {

        let withoutExtension =
            String(
                inputFilename || "vector"
            ).replace(
                /\.(png|jpe?g)$/i,
                ""
            );


        /*
         * Protect against an empty filename.
         */
        if (!withoutExtension) {

            withoutExtension =
                "vector";
        }


        return (
            withoutExtension +
            ".svg"
        );
    }
}



/* =========================================================
   APPLICATION
   ========================================================= */

class ImageToSVGApp {

    constructor() {

        this.statusManager =
            new StatusManager();


        this.uploader =
            new ImageUploader();


        this.previewManager =
            new PreviewManager();


        this.settings =
            new ConversionSettings();


        this.downloadManager =
            new DownloadManager();


        this.converter =
            new SVGConverter(

                this.uploader,

                this.settings,

                this.statusManager
            );


        this.statusManager
            .setReady();


        console.log(
            "Image to SVG Converter ready."
        );
    }
}



/* =========================================================
   START APPLICATION
   ========================================================= */

$(document).ready(
    function () {

        /*
         * Make sure the algorithm classes were loaded before
         * script.js.
         *
         * Classic top-level class declarations are not
         * guaranteed to appear as window properties, so test
         * the identifiers directly.
         */
        try {

            if (
                typeof ImageHolder === "undefined" ||
                typeof CannyEdgeDetector === "undefined" ||
                typeof MarchingSquares === "undefined" ||
                typeof BezierPathFitter === "undefined" ||
                typeof EdgeToSVGColor === "undefined"
            ) {

                throw new Error(
                    "One or more image-to-SVG algorithm classes are missing."
                );
            }

        } catch (error) {

            console.error(
                "Image to SVG Converter failed to initialise:",
                error
            );


            $("#converterStatus, .status")
                .text(
                    "SCRIPT ERROR"
                );


            return;
        }


        /*
         * Start application.
         *
         * Keep the old vectorForge global as an alias in case
         * anything else in the project still refers to it.
         */
        window.imageToSVG =
            new ImageToSVGApp();


        window.vectorForge =
            window.imageToSVG;
    }
);