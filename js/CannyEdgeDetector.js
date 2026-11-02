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
 * Class: CannyEdgeDetector
 * --------------------------------------------------------------------
 *
 * CannyEdgeDetector implements the Canny edge-detection algorithm for
 * raster images used by the VectorForge PNG-to-SVG conversion pipeline.
 *
 * This JavaScript implementation is based directly on the corresponding
 * Java CannyEdgeDetector class. Browser ImageData replaces Java's
 * BufferedImage, while the image-processing stages and public interface
 * remain intentionally similar.
 *
 * Processing stages:
 *
 *     Source raster image
 *         -> Rec.709 grayscale conversion
 *         -> optional 3x3 Gaussian smoothing
 *         -> Sobel X/Y gradient calculation
 *         -> gradient magnitude calculation
 *         -> non-maximum suppression
 *         -> low/high double threshold
 *         -> hysteresis edge tracking
 *         -> binary edge image
 *
 * In addition to the final binary edge image, analyze(...) retains the
 * continuous Sobel gradient magnitude and non-maximum-suppressed
 * magnitude fields.
 *
 * These continuous fields may later be used by contour-processing
 * algorithms that require more information than a binary edge map.
 *
 * The traditional detect(...) method returns only the final ImageHolder
 * containing white edge pixels on a black background.
 *
 * --------------------------------------------------------------------
 */


class CannyEdgeDetector {

    // =========================================================
    // Result
    // =========================================================

    /**
     * Complete result of a Canny analysis.
     */
    static Result = class {

        constructor(
            edgeImage,
            gradientMagnitude,
            suppressedMagnitude,
            width,
            height,
            maxGradientMagnitude,
            maxSuppressedMagnitude
        ) {

            this.edgeImage =
                edgeImage;

            this.gradientMagnitude =
                gradientMagnitude;

            this.suppressedMagnitude =
                suppressedMagnitude;

            this.width =
                width;

            this.height =
                height;

            this.maxGradientMagnitude =
                maxGradientMagnitude;

            this.maxSuppressedMagnitude =
                maxSuppressedMagnitude;
        }


        getEdgeImage() {

            return this.edgeImage;
        }


        getGradientMagnitude() {

            return this.gradientMagnitude;
        }


        getSuppressedMagnitude() {

            return this.suppressedMagnitude;
        }


        getWidth() {

            return this.width;
        }


        getHeight() {

            return this.height;
        }


        getMaxGradientMagnitude() {

            return this.maxGradientMagnitude;
        }


        getMaxSuppressedMagnitude() {

            return this.maxSuppressedMagnitude;
        }


        /**
         * Return the NMS field normalised into 0..255.
         *
         * @returns {Float64Array}
         */
        getNormalizedSuppressedMagnitude() {

            const normalized =
                new Float64Array(
                    this.suppressedMagnitude.length
                );

            if (this.maxSuppressedMagnitude <= 0.0) {

                return normalized;
            }

            const scale =
                255.0 /
                this.maxSuppressedMagnitude;

            for (
                let i = 0;
                i < this.suppressedMagnitude.length;
                i++
            ) {

                normalized[i] =
                    this.suppressedMagnitude[i] *
                    scale;
            }

            return normalized;
        }


        /**
         * Return the raw gradient field normalised into 0..255.
         *
         * @returns {Float64Array}
         */
        getNormalizedGradientMagnitude() {

            const normalized =
                new Float64Array(
                    this.gradientMagnitude.length
                );

            if (this.maxGradientMagnitude <= 0.0) {

                return normalized;
            }

            const scale =
                255.0 /
                this.maxGradientMagnitude;

            for (
                let i = 0;
                i < this.gradientMagnitude.length;
                i++
            ) {

                normalized[i] =
                    this.gradientMagnitude[i] *
                    scale;
            }

            return normalized;
        }
    };


    // =========================================================
    // Public API
    // =========================================================

    /**
     * Compatibility method.
     *
     * Equivalent to the Java API:
     *
     *     ImageHolder edges =
     *         CannyEdgeDetector.detect(
     *             image,
     *             0.10,
     *             0.30,
     *             true
     *         );
     *
     * @param {ImageHolder} input
     * @param {number} low
     * @param {number} high
     * @param {boolean} blur
     * @returns {ImageHolder}
     */
    static detect(
        input,
        low,
        high,
        blur
    ) {

        return CannyEdgeDetector
            .analyze(
                input,
                low,
                high,
                blur
            )
            .getEdgeImage();
    }


    /**
     * Perform complete Canny analysis.
     *
     * low/high are fractions of the maximum NMS magnitude.
     *
     * Typical:
     *
     *     low  = 0.10
     *     high = 0.30
     *
     * @param {ImageHolder} input
     * @param {number} low
     * @param {number} high
     * @param {boolean} blur
     * @returns {CannyEdgeDetector.Result}
     */
    static analyze(
        input,
        low,
        high,
        blur
    ) {

        if (
            input === null ||
            input === undefined ||
            typeof input.getImage !== "function" ||
            input.getImage() === null
        ) {

            throw new Error(
                "Input image cannot be null."
            );
        }

        const image =
            input.getImage();

        const width =
            image.width;

        const height =
            image.height;

        const size =
            width * height;


        /*
         * Images smaller than 3x3 cannot support a complete
         * Sobel neighbourhood.
         */
        if (
            width < 3 ||
            height < 3
        ) {

            const empty =
                new ImageHolder(
                    width,
                    height
                );

            return new CannyEdgeDetector.Result(
                empty,
                new Float64Array(size),
                new Float64Array(size),
                width,
                height,
                0.0,
                0.0
            );
        }


        // -----------------------------------------------------
        // 1. Convert source image to grayscale
        // -----------------------------------------------------

        let gray =
            CannyEdgeDetector.createGrayscale(
                image,
                width,
                height
            );


        // -----------------------------------------------------
        // 2. Optional Gaussian blur
        // -----------------------------------------------------

        if (blur) {

            gray =
                CannyEdgeDetector.gaussianBlur3x3(
                    gray,
                    width,
                    height
                );
        }


        // -----------------------------------------------------
        // 3. Sobel gradients
        // -----------------------------------------------------

        const gradientMagnitude =
            new Float64Array(
                size
            );

        const gradientX =
            new Float64Array(
                size
            );

        const gradientY =
            new Float64Array(
                size
            );

        const maxGradient =
            CannyEdgeDetector.calculateSobel(
                gray,
                width,
                height,
                gradientX,
                gradientY,
                gradientMagnitude
            );


        // -----------------------------------------------------
        // 4. Non-maximum suppression
        // -----------------------------------------------------

        const suppressedMagnitude =
            new Float64Array(
                size
            );

        const maxSuppressed =
            CannyEdgeDetector.nonMaximumSuppression(
                gradientMagnitude,
                gradientX,
                gradientY,
                suppressedMagnitude,
                width,
                height
            );


        // -----------------------------------------------------
        // 5. Threshold validation
        // -----------------------------------------------------

        low =
            CannyEdgeDetector.clamp01(
                low
            );

        high =
            CannyEdgeDetector.clamp01(
                high
            );


        /*
         * Match Java behaviour: if the thresholds have been supplied
         * backwards, swap them.
         */
        if (high < low) {

            const temp =
                high;

            high =
                low;

            low =
                temp;
        }


        const lowThreshold =
            low *
            maxSuppressed;

        const highThreshold =
            high *
            maxSuppressed;


        // -----------------------------------------------------
        // 6. Double threshold
        // -----------------------------------------------------

        /*
         * Edge states:
         *
         *     0 = not an edge
         *     1 = weak edge
         *     2 = strong edge
         */
        const edge =
            new Uint8Array(
                size
            );


        /*
         * Java uses ArrayDeque<Integer>.
         *
         * Using an array plus a moving queue index is substantially
         * better than repeatedly calling shift(), which would move
         * the remaining JavaScript array elements.
         */
        const queue =
            [];


        if (maxSuppressed > 0.0) {

            for (
                let y = 1;
                y < height - 1;
                y++
            ) {

                const row =
                    y * width;

                for (
                    let x = 1;
                    x < width - 1;
                    x++
                ) {

                    const index =
                        row + x;

                    const value =
                        suppressedMagnitude[
                            index
                        ];


                    if (
                        value >=
                        highThreshold
                    ) {

                        edge[index] =
                            2;

                        queue.push(
                            index
                        );

                    } else if (
                        value >=
                        lowThreshold
                    ) {

                        edge[index] =
                            1;
                    }
                }
            }
        }


        // -----------------------------------------------------
        // 7. Hysteresis
        // -----------------------------------------------------

        CannyEdgeDetector.hysteresis(
            edge,
            queue,
            width,
            height
        );


        // -----------------------------------------------------
        // 8. Build traditional binary edge image
        // -----------------------------------------------------

        const edgeImage =
            CannyEdgeDetector.createEdgeImage(
                edge,
                width,
                height
            );


        return new CannyEdgeDetector.Result(
            edgeImage,
            gradientMagnitude,
            suppressedMagnitude,
            width,
            height,
            maxGradient,
            maxSuppressed
        );
    }


    // =========================================================
    // Grayscale
    // =========================================================

    /**
     * Convert browser ImageData into a grayscale scalar field.
     *
     * Uses Rec.709 luminance:
     *
     *     Y =
     *         0.2126 R
     *       + 0.7152 G
     *       + 0.0722 B
     *
     * Transparency is also included in the resulting intensity.
     *
     * @param {ImageData} image
     * @param {number} width
     * @param {number} height
     * @returns {Float64Array}
     */
    static createGrayscale(
        image,
        width,
        height
    ) {

        const gray =
            new Float64Array(
                width * height
            );

        const pixels =
            image.data;


        for (
            let y = 0;
            y < height;
            y++
        ) {

            const row =
                y * width;

            for (
                let x = 0;
                x < width;
                x++
            ) {

                const pixelIndex =
                    (
                        row + x
                    ) * 4;


                const red =
                    pixels[
                        pixelIndex
                    ];

                const green =
                    pixels[
                        pixelIndex + 1
                    ];

                const blue =
                    pixels[
                        pixelIndex + 2
                    ];

                const alpha =
                    pixels[
                        pixelIndex + 3
                    ];


                /*
                 * Rec.709 luminance.
                 */
                let luminance =
                    0.2126 * red +
                    0.7152 * green +
                    0.0722 * blue;


                /*
                 * Account for transparent pixels.
                 *
                 * For normal opaque images alpha = 255 and this
                 * therefore has no effect.
                 */
                luminance *=
                    alpha / 255.0;


                gray[
                    row + x
                ] =
                    luminance;
            }
        }


        return gray;
    }


    // =========================================================
    // Sobel
    // =========================================================

    /**
     * Calculate Sobel X/Y gradients and Euclidean gradient magnitude.
     *
     * @returns {number} maximum gradient magnitude
     */
    static calculateSobel(
        gray,
        width,
        height,
        gradientX,
        gradientY,
        magnitude
    ) {

        let maximum =
            0.0;


        for (
            let y = 1;
            y < height - 1;
            y++
        ) {

            const row =
                y * width;


            for (
                let x = 1;
                x < width - 1;
                x++
            ) {

                const i =
                    row + x;


                const a00 =
                    gray[
                        i - width - 1
                    ];

                const a01 =
                    gray[
                        i - width
                    ];

                const a02 =
                    gray[
                        i - width + 1
                    ];

                const a10 =
                    gray[
                        i - 1
                    ];

                const a12 =
                    gray[
                        i + 1
                    ];

                const a20 =
                    gray[
                        i + width - 1
                    ];

                const a21 =
                    gray[
                        i + width
                    ];

                const a22 =
                    gray[
                        i + width + 1
                    ];


                /*
                 * Sobel horizontal gradient.
                 */
                const gx =
                    -a00
                    + a02
                    - 2.0 * a10
                    + 2.0 * a12
                    - a20
                    + a22;


                /*
                 * Sobel vertical gradient.
                 */
                const gy =
                    a00
                    + 2.0 * a01
                    + a02
                    - a20
                    - 2.0 * a21
                    - a22;


                /*
                 * Proper Euclidean gradient magnitude.
                 */
                const m =
                    Math.hypot(
                        gx,
                        gy
                    );


                gradientX[i] =
                    gx;

                gradientY[i] =
                    gy;

                magnitude[i] =
                    m;


                if (m > maximum) {

                    maximum =
                        m;
                }
            }
        }


        return maximum;
    }


    // =========================================================
    // Non-maximum suppression
    // =========================================================

    /**
     * Thin gradient responses by retaining only local maxima in the
     * gradient direction.
     *
     * The direction is quantised to the four conventional Canny
     * orientations:
     *
     *     0 degrees
     *     45 degrees
     *     90 degrees
     *     135 degrees
     *
     * @returns {number} maximum surviving magnitude
     */
    static nonMaximumSuppression(
        magnitude,
        gradientX,
        gradientY,
        output,
        width,
        height
    ) {

        let maximum =
            0.0;


        for (
            let y = 1;
            y < height - 1;
            y++
        ) {

            const row =
                y * width;


            for (
                let x = 1;
                x < width - 1;
                x++
            ) {

                const i =
                    row + x;

                const m =
                    magnitude[
                        i
                    ];


                if (m <= 0.0) {

                    continue;
                }


                const gx =
                    gradientX[
                        i
                    ];

                const gy =
                    gradientY[
                        i
                    ];


                /*
                 * Java:
                 *
                 * Math.toDegrees(
                 *     Math.atan2(gy, gx)
                 * )
                 */
                let angle =
                    Math.atan2(
                        gy,
                        gx
                    ) *
                    180.0 /
                    Math.PI;


                if (angle < 0.0) {

                    angle +=
                        180.0;
                }


                let m1;
                let m2;


                /*
                 * Quantise the gradient direction to the four
                 * standard Canny NMS orientations.
                 */
                if (
                    angle < 22.5 ||
                    angle >= 157.5
                ) {

                    // Horizontal gradient

                    m1 =
                        magnitude[
                            i - 1
                        ];

                    m2 =
                        magnitude[
                            i + 1
                        ];

                } else if (
                    angle < 67.5
                ) {

                    // 45 degrees

                    m1 =
                        magnitude[
                            i - width + 1
                        ];

                    m2 =
                        magnitude[
                            i + width - 1
                        ];

                } else if (
                    angle < 112.5
                ) {

                    // Vertical gradient

                    m1 =
                        magnitude[
                            i - width
                        ];

                    m2 =
                        magnitude[
                            i + width
                        ];

                } else {

                    // 135 degrees

                    m1 =
                        magnitude[
                            i - width - 1
                        ];

                    m2 =
                        magnitude[
                            i + width + 1
                        ];
                }


                if (
                    m >= m1 &&
                    m >= m2
                ) {

                    output[i] =
                        m;


                    if (m > maximum) {

                        maximum =
                            m;
                    }
                }
            }
        }


        return maximum;
    }


    // =========================================================
    // Hysteresis
    // =========================================================

    /**
     * Follow weak edges connected to strong edges.
     *
     * Uses an 8-connected neighbourhood, matching the Java
     * implementation.
     */
    static hysteresis(
        edge,
        queue,
        width,
        height
    ) {

        /*
         * Do not use queue.shift().
         *
         * Maintaining a read index gives effectively O(1) queue
         * removal and is much more suitable for large images.
         */
        let queueIndex =
            0;


        while (
            queueIndex <
            queue.length
        ) {

            const index =
                queue[
                    queueIndex++
                ];


            const x =
                index %
                width;

            const y =
                Math.floor(
                    index /
                    width
                );


            /*
             * Examine the eight surrounding pixels.
             */
            for (
                let dy = -1;
                dy <= 1;
                dy++
            ) {

                for (
                    let dx = -1;
                    dx <= 1;
                    dx++
                ) {

                    if (
                        dx === 0 &&
                        dy === 0
                    ) {

                        continue;
                    }


                    const nx =
                        x + dx;

                    const ny =
                        y + dy;


                    /*
                     * Keep the border excluded, matching the Java
                     * implementation.
                     */
                    if (
                        nx <= 0 ||
                        nx >= width - 1 ||
                        ny <= 0 ||
                        ny >= height - 1
                    ) {

                        continue;
                    }


                    const neighbour =
                        ny * width +
                        nx;


                    /*
                     * A weak edge connected to a strong edge becomes
                     * strong and is itself added to the queue.
                     */
                    if (
                        edge[
                            neighbour
                        ] === 1
                    ) {

                        edge[
                            neighbour
                        ] =
                            2;


                        queue.push(
                            neighbour
                        );
                    }
                }
            }
        }
    }


    // =========================================================
    // Output
    // =========================================================

    /**
     * Convert the edge-state field into a traditional black/white
     * ImageHolder.
     *
     * Strong edges become white.
     * Everything else becomes black.
     *
     * @returns {ImageHolder}
     */
    static createEdgeImage(
        edge,
        width,
        height
    ) {

        const output =
            new ImageHolder(
                width,
                height
            );


        /*
         * Work directly with ImageData for efficiency.
         *
         * This produces exactly the same logical output as repeatedly
         * calling ImageHolder.setRGB(), but avoids coordinate checking
         * and function-call overhead for every pixel.
         */
        const pixels =
            output.getData();


        for (
            let y = 0;
            y < height;
            y++
        ) {

            const row =
                y * width;


            for (
                let x = 0;
                x < width;
                x++
            ) {

                const value =
                    edge[
                        row + x
                    ] === 2
                        ? 255
                        : 0;


                const pixelIndex =
                    (
                        row + x
                    ) * 4;


                pixels[
                    pixelIndex
                ] =
                    value;

                pixels[
                    pixelIndex + 1
                ] =
                    value;

                pixels[
                    pixelIndex + 2
                ] =
                    value;

                pixels[
                    pixelIndex + 3
                ] =
                    255;
            }
        }


        return output;
    }


    // =========================================================
    // Gaussian blur
    // =========================================================

    /**
     * Small Gaussian blur:
     *
     *     1 2 1
     *     2 4 2
     *     1 2 1
     *
     * divided by 16.
     *
     * Border coordinates are clamped to the nearest valid pixel,
     * matching the Java implementation.
     *
     * @returns {Float64Array}
     */
    static gaussianBlur3x3(
        source,
        width,
        height
    ) {

        const output =
            new Float64Array(
                width * height
            );


        for (
            let y = 0;
            y < height;
            y++
        ) {

            const y0 =
                Math.max(
                    0,
                    y - 1
                );

            const y1 =
                y;

            const y2 =
                Math.min(
                    height - 1,
                    y + 1
                );


            const row0 =
                y0 * width;

            const row1 =
                y1 * width;

            const row2 =
                y2 * width;


            for (
                let x = 0;
                x < width;
                x++
            ) {

                const x0 =
                    Math.max(
                        0,
                        x - 1
                    );

                const x1 =
                    x;

                const x2 =
                    Math.min(
                        width - 1,
                        x + 1
                    );


                const sum =
                    source[
                        row0 + x0
                    ]

                    + 2.0 *
                    source[
                        row0 + x1
                    ]

                    + source[
                        row0 + x2
                    ]

                    + 2.0 *
                    source[
                        row1 + x0
                    ]

                    + 4.0 *
                    source[
                        row1 + x1
                    ]

                    + 2.0 *
                    source[
                        row1 + x2
                    ]

                    + source[
                        row2 + x0
                    ]

                    + 2.0 *
                    source[
                        row2 + x1
                    ]

                    + source[
                        row2 + x2
                    ];


                output[
                    row1 + x1
                ] =
                    sum / 16.0;
            }
        }


        return output;
    }


    // =========================================================
    // Utility
    // =========================================================

    /**
     * Clamp a threshold fraction into 0..1.
     */
    static clamp01(
        value
    ) {

        /*
         * Protect the algorithm from NaN / Infinity as well as values
         * outside the expected range.
         */
        if (
            !Number.isFinite(
                value
            )
        ) {

            return 0.0;
        }


        if (value < 0.0) {

            return 0.0;
        }


        if (value > 1.0) {

            return 1.0;
        }


        return value;
    }
}