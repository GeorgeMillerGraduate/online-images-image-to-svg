/*
 * MIT License
 *
 * Copyright (c) 2026 George Miller
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
 * BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
 * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * --------------------------------------------------------------------
 * Class: ImageHolder
 * --------------------------------------------------------------------
 *
 * ImageHolder provides a lightweight wrapper around the browser's
 * ImageData representation for creating, accessing and modifying
 * raster images.
 *
 * The class is the JavaScript equivalent of the Java ImageHolder used
 * by the PNG-to-SVG converter. It provides a common raster image
 * representation for the browser implementation while maintaining an
 * interface similar to the original Java class.
 *
 * Browser ImageData stores pixels as consecutive RGBA bytes:
 *
 *     [R, G, B, A, R, G, B, A, ...]
 *
 * Each colour channel occupies one unsigned 8-bit value in the range
 * 0-255.
 *
 * ImageHolder provides methods for reading and modifying individual
 * red, green, blue and alpha channels. Complete RGB and RGBA values can
 * also be written directly.
 *
 * Channel setters preserve all channels that are not explicitly being
 * changed. Values supplied to setters are clamped to the valid 0-255
 * range.
 *
 * Images can be constructed from:
 *
 *     - a width and height;
 *     - an existing ImageData object;
 *     - a Canvas element;
 *     - an HTMLImageElement;
 *     - a File or Blob containing an image.
 *
 * File and Blob loading is asynchronous because image decoding in the
 * browser is asynchronous. The static fromFile(...) and fromBlob(...)
 * methods therefore return Promises containing the completed
 * ImageHolder.
 *
 * Within VectorForge, ImageHolder is intended to provide raster data to
 * components such as CannyEdgeDetector, MarchingSquares and
 * EdgeToSVGColor.
 *
 * Main responsibilities:
 *
 *     - create new transparent RGBA images;
 *     - wrap existing ImageData;
 *     - load browser image files;
 *     - read individual RGBA channels;
 *     - modify individual RGBA channels;
 *     - write complete RGB or RGBA pixel values;
 *     - clamp colour values to the valid 8-bit range;
 *     - expose the underlying ImageData; and
 *     - transfer raster data to a Canvas when required.
 *
 * --------------------------------------------------------------------
 */

class ImageHolder {

    /**
     * Construct a new ImageHolder.
     *
     * Supported forms:
     *
     *     new ImageHolder(width, height)
     *     new ImageHolder(imageData)
     *
     * @param {number|ImageData} widthOrImageData
     * @param {number} [height]
     */
    constructor(widthOrImageData, height) {

        /*
         * Existing ImageData.
         */
        if (widthOrImageData instanceof ImageData) {

            this.imageData = widthOrImageData;

            return;
        }

        /*
         * Width / height constructor.
         */
        const width = widthOrImageData;

        if (!Number.isInteger(width) ||
            !Number.isInteger(height) ||
            width <= 0 ||
            height <= 0) {

            throw new Error(
                "ImageHolder requires positive integer width and height."
            );
        }

        this.imageData = new ImageData(
            width,
            height
        );
    }


    // =========================================================
    // Construction helpers
    // =========================================================

    /**
     * Create an ImageHolder from an existing ImageData object.
     *
     * @param {ImageData} imageData
     * @returns {ImageHolder}
     */
    static fromImageData(imageData) {

        if (!(imageData instanceof ImageData)) {

            throw new Error(
                "fromImageData requires an ImageData object."
            );
        }

        return new ImageHolder(
            imageData
        );
    }


    /**
     * Create an ImageHolder containing a COPY of ImageData.
     *
     * This is useful when the source image must not be modified.
     *
     * @param {ImageData} imageData
     * @returns {ImageHolder}
     */
    static copyOf(imageData) {

        if (!(imageData instanceof ImageData)) {

            throw new Error(
                "copyOf requires an ImageData object."
            );
        }

        const copy = new ImageData(
            new Uint8ClampedArray(
                imageData.data
            ),
            imageData.width,
            imageData.height
        );

        return new ImageHolder(
            copy
        );
    }


    /**
     * Create an ImageHolder from an HTML canvas.
     *
     * @param {HTMLCanvasElement} canvas
     * @returns {ImageHolder}
     */
    static fromCanvas(canvas) {

        if (!(canvas instanceof HTMLCanvasElement)) {

            throw new Error(
                "fromCanvas requires an HTMLCanvasElement."
            );
        }

        const context =
            canvas.getContext(
                "2d",
                {
                    willReadFrequently: true
                }
            );

        if (context === null) {

            throw new Error(
                "Could not obtain 2D canvas context."
            );
        }

        const imageData =
            context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
            );

        return new ImageHolder(
            imageData
        );
    }


    /**
     * Create an ImageHolder from an HTMLImageElement.
     *
     * The image must already have completed loading.
     *
     * @param {HTMLImageElement} image
     * @returns {ImageHolder}
     */
    static fromImageElement(image) {

        if (!(image instanceof HTMLImageElement)) {

            throw new Error(
                "fromImageElement requires an HTMLImageElement."
            );
        }

        if (!image.complete ||
            image.naturalWidth <= 0 ||
            image.naturalHeight <= 0) {

            throw new Error(
                "Image has not finished loading."
            );
        }

        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width =
            image.naturalWidth;

        canvas.height =
            image.naturalHeight;

        const context =
            canvas.getContext(
                "2d",
                {
                    willReadFrequently: true
                }
            );

        if (context === null) {

            throw new Error(
                "Could not obtain 2D canvas context."
            );
        }

        context.drawImage(
            image,
            0,
            0
        );

        const imageData =
            context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
            );

        return new ImageHolder(
            imageData
        );
    }


    /**
     * Asynchronously create an ImageHolder from a File.
     *
     * Intended for files obtained from:
     *
     *     <input type="file">
     *
     * @param {File} file
     * @returns {Promise<ImageHolder>}
     */
    static async fromFile(file) {

        if (!(file instanceof File)) {

            throw new Error(
                "fromFile requires a File object."
            );
        }

        return ImageHolder.fromBlob(
            file
        );
    }


    /**
     * Asynchronously create an ImageHolder from an image Blob.
     *
     * @param {Blob} blob
     * @returns {Promise<ImageHolder>}
     */
    static async fromBlob(blob) {

        if (!(blob instanceof Blob)) {

            throw new Error(
                "fromBlob requires a Blob object."
            );
        }

        /*
         * createImageBitmap avoids having to create a temporary
         * <img> element and object URL.
         */
        if (typeof createImageBitmap === "function") {

            const bitmap =
                await createImageBitmap(
                    blob
                );

            try {

                const canvas =
                    document.createElement(
                        "canvas"
                    );

                canvas.width =
                    bitmap.width;

                canvas.height =
                    bitmap.height;

                const context =
                    canvas.getContext(
                        "2d",
                        {
                            willReadFrequently: true
                        }
                    );

                if (context === null) {

                    throw new Error(
                        "Could not obtain 2D canvas context."
                    );
                }

                context.drawImage(
                    bitmap,
                    0,
                    0
                );

                const imageData =
                    context.getImageData(
                        0,
                        0,
                        bitmap.width,
                        bitmap.height
                    );

                return new ImageHolder(
                    imageData
                );

            } finally {

                if (typeof bitmap.close === "function") {

                    bitmap.close();
                }
            }
        }

        /*
         * Compatibility fallback for browsers without
         * createImageBitmap().
         */
        return ImageHolder.loadBlobUsingImageElement(
            blob
        );
    }


    /**
     * Compatibility loader using an HTMLImageElement.
     *
     * @param {Blob} blob
     * @returns {Promise<ImageHolder>}
     */
    static loadBlobUsingImageElement(blob) {

        return new Promise(
            (resolve, reject) => {

                const url =
                    URL.createObjectURL(
                        blob
                    );

                const image =
                    new Image();

                image.onload = () => {

                    try {

                        const holder =
                            ImageHolder.fromImageElement(
                                image
                            );

                        resolve(
                            holder
                        );

                    } catch (error) {

                        reject(
                            error
                        );

                    } finally {

                        URL.revokeObjectURL(
                            url
                        );
                    }
                };

                image.onerror = () => {

                    URL.revokeObjectURL(
                        url
                    );

                    reject(
                        new Error(
                            "Could not decode the supplied image."
                        )
                    );
                };

                image.src =
                    url;
            }
        );
    }


    // =========================================================
    // Dimensions
    // =========================================================

    /**
     * Return image width.
     *
     * @returns {number}
     */
    getWidth() {

        return this.imageData.width;
    }


    /**
     * Return image height.
     *
     * @returns {number}
     */
    getHeight() {

        return this.imageData.height;
    }


    // =========================================================
    // Setters
    // =========================================================

    /**
     * Set the red channel while preserving G, B and A.
     */
    setRed(x, y, red) {

        const index =
            this.getPixelIndex(
                x,
                y
            );

        this.imageData.data[index] =
            this.clamp(
                red
            );
    }


    /**
     * Set the green channel while preserving R, B and A.
     */
    setGreen(x, y, green) {

        const index =
            this.getPixelIndex(
                x,
                y
            );

        this.imageData.data[index + 1] =
            this.clamp(
                green
            );
    }


    /**
     * Set the blue channel while preserving R, G and A.
     */
    setBlue(x, y, blue) {

        const index =
            this.getPixelIndex(
                x,
                y
            );

        this.imageData.data[index + 2] =
            this.clamp(
                blue
            );
    }


    /**
     * Set the alpha channel while preserving R, G and B.
     */
    setAlpha(x, y, alpha) {

        const index =
            this.getPixelIndex(
                x,
                y
            );

        this.imageData.data[index + 3] =
            this.clamp(
                alpha
            );
    }


    /**
     * Set RGB and force alpha to fully opaque.
     *
     * Mirrors the Java ImageHolder.setRGB(...) behaviour.
     */
    setRGB(x, y, red, green, blue) {

        const index =
            this.getPixelIndex(
                x,
                y
            );

        const data =
            this.imageData.data;

        data[index] =
            this.clamp(
                red
            );

        data[index + 1] =
            this.clamp(
                green
            );

        data[index + 2] =
            this.clamp(
                blue
            );

        data[index + 3] =
            255;
    }


    /**
     * Set all four RGBA channels.
     */
    setRGBA(
        x,
        y,
        red,
        green,
        blue,
        alpha
    ) {

        const index =
            this.getPixelIndex(
                x,
                y
            );

        const data =
            this.imageData.data;

        data[index] =
            this.clamp(
                red
            );

        data[index + 1] =
            this.clamp(
                green
            );

        data[index + 2] =
            this.clamp(
                blue
            );

        data[index + 3] =
            this.clamp(
                alpha
            );
    }


    // =========================================================
    // Getters
    // =========================================================

    getRed(x, y) {

        return this.imageData.data[
            this.getPixelIndex(
                x,
                y
            )
        ];
    }


    getGreen(x, y) {

        return this.imageData.data[
            this.getPixelIndex(
                x,
                y
            ) + 1
        ];
    }


    getBlue(x, y) {

        return this.imageData.data[
            this.getPixelIndex(
                x,
                y
            ) + 2
        ];
    }


    getAlpha(x, y) {

        return this.imageData.data[
            this.getPixelIndex(
                x,
                y
            ) + 3
        ];
    }


    /**
     * Return all channels for one pixel.
     *
     * @returns {{r:number, g:number, b:number, a:number}}
     */
    getRGBA(x, y) {

        const index =
            this.getPixelIndex(
                x,
                y
            );

        const data =
            this.imageData.data;

        return {
            r: data[index],
            g: data[index + 1],
            b: data[index + 2],
            a: data[index + 3]
        };
    }


    // =========================================================
    // Utility
    // =========================================================

    /**
     * Java equivalent:
     *
     *     getImage()
     *
     * Java returns BufferedImage.
     * JavaScript returns ImageData.
     */
    getImage() {

        return this.imageData;
    }


    /**
     * Return the underlying Uint8ClampedArray directly.
     *
     * Useful for performance-sensitive algorithms such as Canny.
     */
    getData() {

        return this.imageData.data;
    }


    /**
     * Convert x/y coordinates into an ImageData array index.
     *
     * Each pixel occupies four consecutive entries:
     *
     *     R G B A
     */
    getPixelIndex(x, y) {

        this.validateCoordinates(
            x,
            y
        );

        return (
            y * this.imageData.width + x
        ) * 4;
    }


    /**
     * Ensure coordinates refer to an existing pixel.
     */
    validateCoordinates(x, y) {

        if (!Number.isInteger(x) ||
            !Number.isInteger(y)) {

            throw new Error(
                "Pixel coordinates must be integers."
            );
        }

        if (x < 0 ||
            y < 0 ||
            x >= this.imageData.width ||
            y >= this.imageData.height) {

            throw new RangeError(
                "Pixel coordinate outside image bounds: " +
                "(" + x + ", " + y + ")"
            );
        }
    }


    /**
     * Clamp a value to the unsigned 8-bit range.
     */
    clamp(value) {

        if (!Number.isFinite(value)) {

            return 0;
        }

        return Math.max(
            0,
            Math.min(
                255,
                Math.round(
                    value
                )
            )
        );
    }


    /**
     * Create a deep copy of this ImageHolder.
     *
     * @returns {ImageHolder}
     */
    clone() {

        return ImageHolder.copyOf(
            this.imageData
        );
    }


    /**
     * Copy this image onto a canvas.
     *
     * The canvas is resized to match the image.
     *
     * @param {HTMLCanvasElement} canvas
     */
    drawToCanvas(canvas) {

        if (!(canvas instanceof HTMLCanvasElement)) {

            throw new Error(
                "drawToCanvas requires an HTMLCanvasElement."
            );
        }

        canvas.width =
            this.imageData.width;

        canvas.height =
            this.imageData.height;

        const context =
            canvas.getContext(
                "2d"
            );

        if (context === null) {

            throw new Error(
                "Could not obtain 2D canvas context."
            );
        }

        context.putImageData(
            this.imageData,
            0,
            0
        );
    }


    /**
     * Create a canvas containing this image.
     *
     * @returns {HTMLCanvasElement}
     */
    toCanvas() {

        const canvas =
            document.createElement(
                "canvas"
            );

        this.drawToCanvas(
            canvas
        );

        return canvas;
    }
}