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
 * Class: MarchingSquares
 * --------------------------------------------------------------------
 *
 * MarchingSquares extracts ordered two-dimensional contours from raster
 * images and arbitrary scalar fields using the Marching Squares
 * algorithm.
 *
 * This JavaScript implementation is based directly on the corresponding
 * Java MarchingSquares class used by the VectorForge PNG-to-SVG
 * conversion pipeline.
 *
 * The algorithm examines each 2x2 cell of a scalar field, determines
 * which samples lie above or below a specified threshold, and generates
 * contour segments according to the resulting Marching Squares state.
 *
 * Threshold crossings are interpolated between neighbouring samples.
 * This allows contour vertices to occupy fractional pixel coordinates
 * rather than being restricted to fixed half-pixel positions.
 *
 * Ambiguous saddle configurations, states 5 and 10, are resolved using
 * the average scalar value at the centre of the cell.
 *
 * Individual contour segments are subsequently assembled into ordered
 * open and closed contours using an adjacency graph. At junctions, the
 * continuation producing the smallest directional change is preferred.
 *
 * Floating-point coordinates are quantised only for connectivity and
 * equality testing. Original double-precision coordinates are retained
 * in the returned contours.
 *
 * Processing stages:
 *
 *     Raster image or scalar field
 *         -> scalar intensity extraction
 *         -> 2x2 cell classification
 *         -> Marching Squares state selection
 *         -> interpolated threshold crossings
 *         -> saddle-case resolution
 *         -> segment generation
 *         -> adjacency graph construction
 *         -> connected segment traversal
 *         -> ordered contours
 *
 * --------------------------------------------------------------------
 */


class MarchingSquares {

    static EPSILON =
        1e-9;


    /*
     * Coordinates used for connectivity are quantised to this
     * precision.
     *
     * This mirrors the Java Point.equals()/hashCode() behaviour.
     */
    static KEY_SCALE =
        1_000_000.0;


    // =========================================================
    // Public API
    // =========================================================

    /**
     * Compatibility method for the existing pipeline.
     *
     * @param {ImageHolder} image
     * @param {number} threshold
     * @returns {Array<Array<Array<number>>>}
     */
    static trace(
        image,
        threshold
    ) {

        return MarchingSquares.traceInterpolated(
            image,
            threshold
        );
    }


    /**
     * Perform interpolated Marching Squares using the image's
     * luminance as the scalar field.
     *
     * @param {ImageHolder} image
     * @param {number} threshold
     * @returns {Array<Array<Array<number>>>}
     */
    static traceInterpolated(
        image,
        threshold
    ) {

        if (
            image === null ||
            image === undefined ||
            typeof image.getImage !== "function"
        ) {

            throw new Error(
                "Image cannot be null."
            );
        }


        const source =
            image.getImage();


        if (
            source === null ||
            source === undefined
        ) {

            throw new Error(
                "Image data cannot be null."
            );
        }


        const width =
            source.width;

        const height =
            source.height;


        if (
            width < 2 ||
            height < 2
        ) {

            return [];
        }


        const field =
            MarchingSquares.createIntensityField(
                image,
                width,
                height
            );


        return MarchingSquares.traceField(
            field,
            width,
            height,
            threshold
        );
    }


    /**
     * Trace an arbitrary scalar field.
     *
     * This allows MarchingSquares to operate independently of
     * ImageHolder.
     *
     * Possible scalar fields include:
     *
     *     - grayscale intensity;
     *     - gradient magnitude;
     *     - colour distance;
     *     - alpha;
     *     - segmentation probability.
     *
     * @param {Array<number>|Float64Array} field
     * @param {number} width
     * @param {number} height
     * @param {number} threshold
     *
     * @returns {Array<Array<Array<number>>>}
     */
    static traceField(
        field,
        width,
        height,
        threshold
    ) {

        if (
            field === null ||
            field === undefined
        ) {

            throw new Error(
                "Field cannot be null."
            );
        }


        if (
            width < 2 ||
            height < 2
        ) {

            return [];
        }


        if (
            field.length !==
            width * height
        ) {

            throw new Error(
                "Field size does not match width * height."
            );
        }


        const segments =
            [];


        /*
         * Examine every 2x2 cell.
         */
        for (
            let y = 0;
            y < height - 1;
            y++
        ) {

            for (
                let x = 0;
                x < width - 1;
                x++
            ) {

                /*
                 * Cell:
                 *
                 * A -------- B
                 * |          |
                 * |          |
                 * D -------- C
                 */

                const a =
                    field[
                        y * width + x
                    ];

                const b =
                    field[
                        y * width + x + 1
                    ];

                const c =
                    field[
                        (y + 1) * width + x + 1
                    ];

                const d =
                    field[
                        (y + 1) * width + x
                    ];


                let state =
                    0;


                if (a >= threshold) {

                    state |=
                        8;
                }


                if (b >= threshold) {

                    state |=
                        4;
                }


                if (c >= threshold) {

                    state |=
                        2;
                }


                if (d >= threshold) {

                    state |=
                        1;
                }


                /*
                 * Entirely below or entirely above the threshold.
                 *
                 * No contour crosses this cell.
                 */
                if (
                    state === 0 ||
                    state === 15
                ) {

                    continue;
                }


                /*
                 * Calculate the actual threshold crossing on each
                 * side of the cell.
                 *
                 * These are not restricted to x + 0.5 / y + 0.5.
                 */

                const top =
                    MarchingSquares.interpolate(
                        x,
                        y,
                        a,

                        x + 1.0,
                        y,
                        b,

                        threshold
                    );


                const right =
                    MarchingSquares.interpolate(
                        x + 1.0,
                        y,
                        b,

                        x + 1.0,
                        y + 1.0,
                        c,

                        threshold
                    );


                const bottom =
                    MarchingSquares.interpolate(
                        x,
                        y + 1.0,
                        d,

                        x + 1.0,
                        y + 1.0,
                        c,

                        threshold
                    );


                const left =
                    MarchingSquares.interpolate(
                        x,
                        y,
                        a,

                        x,
                        y + 1.0,
                        d,

                        threshold
                    );


                /*
                 * Resolve the 16 Marching Squares cases.
                 */
                switch (state) {

                    case 1:

                        MarchingSquares.addSegment(
                            segments,
                            left,
                            bottom
                        );

                        break;


                    case 2:

                        MarchingSquares.addSegment(
                            segments,
                            bottom,
                            right
                        );

                        break;


                    case 3:

                        MarchingSquares.addSegment(
                            segments,
                            left,
                            right
                        );

                        break;


                    case 4:

                        MarchingSquares.addSegment(
                            segments,
                            top,
                            right
                        );

                        break;


                    case 5:

                        MarchingSquares.resolveSaddleFive(
                            segments,
                            top,
                            right,
                            bottom,
                            left,
                            a,
                            b,
                            c,
                            d,
                            threshold
                        );

                        break;


                    case 6:

                        MarchingSquares.addSegment(
                            segments,
                            top,
                            bottom
                        );

                        break;


                    case 7:

                        MarchingSquares.addSegment(
                            segments,
                            top,
                            left
                        );

                        break;


                    case 8:

                        MarchingSquares.addSegment(
                            segments,
                            left,
                            top
                        );

                        break;


                    case 9:

                        MarchingSquares.addSegment(
                            segments,
                            top,
                            bottom
                        );

                        break;


                    case 10:

                        MarchingSquares.resolveSaddleTen(
                            segments,
                            top,
                            right,
                            bottom,
                            left,
                            a,
                            b,
                            c,
                            d,
                            threshold
                        );

                        break;


                    case 11:

                        MarchingSquares.addSegment(
                            segments,
                            top,
                            right
                        );

                        break;


                    case 12:

                        MarchingSquares.addSegment(
                            segments,
                            left,
                            right
                        );

                        break;


                    case 13:

                        MarchingSquares.addSegment(
                            segments,
                            bottom,
                            right
                        );

                        break;


                    case 14:

                        MarchingSquares.addSegment(
                            segments,
                            left,
                            bottom
                        );

                        break;


                    default:

                        break;
                }
            }
        }


        return MarchingSquares.connectSegments(
            segments
        );
    }


    // =========================================================
    // Scalar field
    // =========================================================

    /**
     * Convert an ImageHolder into a luminance scalar field.
     *
     * Rec.709 luminance:
     *
     *     Y =
     *         0.2126 R
     *       + 0.7152 G
     *       + 0.0722 B
     *
     * Alpha is applied to the luminance so completely transparent
     * pixels have zero intensity.
     *
     * @returns {Float64Array}
     */
    static createIntensityField(
        image,
        width,
        height
    ) {

        const result =
            new Float64Array(
                width * height
            );


        /*
         * Work directly with ImageData for efficiency.
         */
        const imageData =
            image.getImage();

        const pixels =
            imageData.data;


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

                const imageIndex =
                    (
                        row + x
                    ) * 4;


                const red =
                    pixels[
                        imageIndex
                    ];

                const green =
                    pixels[
                        imageIndex + 1
                    ];

                const blue =
                    pixels[
                        imageIndex + 2
                    ];

                const alpha =
                    pixels[
                        imageIndex + 3
                    ];


                /*
                 * Rec.709-style luminance.
                 */
                let luminance =
                    0.2126 * red
                    + 0.7152 * green
                    + 0.0722 * blue;


                /*
                 * Transparent pixels are treated as zero-valued.
                 */
                luminance *=
                    alpha / 255.0;


                result[
                    row + x
                ] =
                    luminance;
            }
        }


        return result;
    }


    // =========================================================
    // Interpolation
    // =========================================================

    /**
     * Find the threshold position between two scalar samples.
     *
     * @returns {MarchingSquares.Point}
     */
    static interpolate(
        x1,
        y1,
        value1,
        x2,
        y2,
        value2,
        threshold
    ) {

        const difference =
            value2 -
            value1;


        let t;


        if (
            Math.abs(
                difference
            ) <
            MarchingSquares.EPSILON
        ) {

            /*
             * Flat edge.
             *
             * The midpoint is the safest result.
             */
            t =
                0.5;

        } else {

            t =
                (
                    threshold -
                    value1
                ) /
                difference;


            /*
             * Floating-point / threshold safety.
             */
            t =
                Math.max(
                    0.0,
                    Math.min(
                        1.0,
                        t
                    )
                );
        }


        const x =
            x1 +
            t *
            (
                x2 -
                x1
            );


        const y =
            y1 +
            t *
            (
                y2 -
                y1
            );


        return new MarchingSquares.Point(
            x,
            y
        );
    }


    // =========================================================
    // Ambiguous saddle cases
    // =========================================================

    /**
     * Resolve state 5 using the scalar value at the centre of
     * the cell rather than making an arbitrary connection.
     */
    static resolveSaddleFive(
        segments,
        top,
        right,
        bottom,
        left,
        a,
        b,
        c,
        d,
        threshold
    ) {

        const centre =
            (
                a +
                b +
                c +
                d
            ) /
            4.0;


        if (
            centre >=
            threshold
        ) {

            MarchingSquares.addSegment(
                segments,
                top,
                left
            );


            MarchingSquares.addSegment(
                segments,
                right,
                bottom
            );

        } else {

            MarchingSquares.addSegment(
                segments,
                top,
                right
            );


            MarchingSquares.addSegment(
                segments,
                left,
                bottom
            );
        }
    }


    /**
     * Resolve state 10 using the scalar value at the centre of
     * the cell.
     */
    static resolveSaddleTen(
        segments,
        top,
        right,
        bottom,
        left,
        a,
        b,
        c,
        d,
        threshold
    ) {

        const centre =
            (
                a +
                b +
                c +
                d
            ) /
            4.0;


        if (
            centre >=
            threshold
        ) {

            MarchingSquares.addSegment(
                segments,
                top,
                right
            );


            MarchingSquares.addSegment(
                segments,
                left,
                bottom
            );

        } else {

            MarchingSquares.addSegment(
                segments,
                top,
                left
            );


            MarchingSquares.addSegment(
                segments,
                right,
                bottom
            );
        }
    }


    // =========================================================
    // Segment construction
    // =========================================================

    static addSegment(
        segments,
        a,
        b
    ) {

        if (
            a === null ||
            b === null ||
            a.equals(b)
        ) {

            return;
        }


        segments.push(
            new MarchingSquares.Segment(
                a,
                b
            )
        );
    }


    // =========================================================
    // Segment -> contour conversion
    // =========================================================

    /**
     * Convert individual contour segments into ordered contours.
     *
     * Java uses:
     *
     *     Map<Point, ArrayList<Integer>>
     *
     * JavaScript Map compares object keys by identity rather than
     * equals()/hashCode(), so quantised coordinate strings are used
     * as the actual map keys.
     */
    static connectSegments(
        segments
    ) {

        const contours =
            [];


        if (
            segments.length === 0
        ) {

            return contours;
        }


        /*
         * Build adjacency graph:
         *
         *     quantised point key
         *         ->
         *     {
         *         point,
         *         segments[]
         *     }
         */
        const adjacency =
            new Map();


        for (
            let i = 0;
            i < segments.length;
            i++
        ) {

            const segment =
                segments[i];


            MarchingSquares.addToAdjacency(
                adjacency,
                segment.a,
                i
            );


            MarchingSquares.addToAdjacency(
                adjacency,
                segment.b,
                i
            );
        }


        const used =
            new Uint8Array(
                segments.length
            );


        /*
         * Open contours first.
         *
         * Their endpoints have graph degree 1.
         */
        for (
            const entry of
            adjacency.values()
        ) {

            if (
                entry.segments.length !==
                1
            ) {

                continue;
            }


            const segmentIndex =
                entry.segments[0];


            if (
                used[
                    segmentIndex
                ] !== 0
            ) {

                continue;
            }


            const contour =
                MarchingSquares.walkContour(
                    entry.point,
                    segments,
                    adjacency,
                    used
                );


            if (
                contour.length >=
                2
            ) {

                contours.push(
                    contour
                );
            }
        }


        /*
         * Remaining unused segments should mostly form closed
         * contours.
         */
        for (
            let i = 0;
            i < segments.length;
            i++
        ) {

            if (
                used[i] !== 0
            ) {

                continue;
            }


            const segment =
                segments[i];


            const contour =
                MarchingSquares.walkContour(
                    segment.a,
                    segments,
                    adjacency,
                    used
                );


            if (
                contour.length >=
                2
            ) {

                contours.push(
                    contour
                );
            }
        }


        return contours;
    }


    /**
     * Add a Point/segment relationship to the adjacency graph.
     */
    static addToAdjacency(
        adjacency,
        point,
        segmentIndex
    ) {

        const key =
            point.getKey();


        let entry =
            adjacency.get(
                key
            );


        if (
            entry === undefined
        ) {

            entry = {
                point: point,
                segments: []
            };


            adjacency.set(
                key,
                entry
            );
        }


        entry.segments.push(
            segmentIndex
        );
    }


    /**
     * Walk through connected segments.
     *
     * If more than one unused continuation exists, choose the one
     * that changes direction the least.
     */
    static walkContour(
        start,
        segments,
        adjacency,
        used
    ) {

        const result =
            [];


        let current =
            start;

        let previous =
            null;


        result.push(
            current.toArray()
        );


        /*
         * At most one more step than the total number of segments.
         *
         * This mirrors the defensive limit in the Java implementation.
         */
        for (
            let steps = 0;
            steps <= segments.length;
            steps++
        ) {

            const entry =
                adjacency.get(
                    current.getKey()
                );


            if (
                entry === undefined ||
                entry.segments.length === 0
            ) {

                break;
            }


            const nextSegmentIndex =
                MarchingSquares.chooseNextSegment(
                    current,
                    previous,
                    entry.segments,
                    segments,
                    used
                );


            if (
                nextSegmentIndex ===
                -1
            ) {

                break;
            }


            used[
                nextSegmentIndex
            ] =
                1;


            const segment =
                segments[
                    nextSegmentIndex
                ];


            const next =
                segment.other(
                    current
                );


            if (
                next === null
            ) {

                break;
            }


            result.push(
                next.toArray()
            );


            previous =
                current;

            current =
                next;


            /*
             * Closed loop.
             */
            if (
                current.equals(
                    start
                )
            ) {

                break;
            }
        }


        return result;
    }


    /**
     * At a junction, prefer the continuation that preserves the
     * current direction.
     */
    static chooseNextSegment(
        current,
        previous,
        connected,
        segments,
        used
    ) {

        let bestIndex =
            -1;


        /*
         * No incoming direction yet.
         */
        if (
            previous === null
        ) {

            for (
                const index of
                connected
            ) {

                if (
                    used[index] ===
                    0
                ) {

                    return index;
                }
            }


            return -1;
        }


        let incomingX =
            current.x -
            previous.x;

        let incomingY =
            current.y -
            previous.y;


        const incomingLength =
            Math.sqrt(
                incomingX *
                incomingX
                +
                incomingY *
                incomingY
            );


        /*
         * Degenerate incoming direction.
         */
        if (
            incomingLength <
            MarchingSquares.EPSILON
        ) {

            for (
                const index of
                connected
            ) {

                if (
                    used[index] ===
                    0
                ) {

                    return index;
                }
            }


            return -1;
        }


        incomingX /=
            incomingLength;

        incomingY /=
            incomingLength;


        let bestDot =
            -Number.MAX_VALUE;


        for (
            const index of
            connected
        ) {

            if (
                used[index] !==
                0
            ) {

                continue;
            }


            const segment =
                segments[
                    index
                ];


            const next =
                segment.other(
                    current
                );


            if (
                next === null
            ) {

                continue;
            }


            let outgoingX =
                next.x -
                current.x;

            let outgoingY =
                next.y -
                current.y;


            const outgoingLength =
                Math.sqrt(
                    outgoingX *
                    outgoingX
                    +
                    outgoingY *
                    outgoingY
                );


            if (
                outgoingLength <
                MarchingSquares.EPSILON
            ) {

                continue;
            }


            outgoingX /=
                outgoingLength;

            outgoingY /=
                outgoingLength;


            const dot =
                incomingX *
                outgoingX
                +
                incomingY *
                outgoingY;


            /*
             * Maximum dot product = smallest turn.
             */
            if (
                dot >
                bestDot
            ) {

                bestDot =
                    dot;

                bestIndex =
                    index;
            }
        }


        return bestIndex;
    }


    // =========================================================
    // Internal geometry
    // =========================================================

    /**
     * Internal two-dimensional point.
     *
     * Java uses long keyX/keyY values and overrides equals/hashCode.
     * JavaScript uses the same rounded coordinates but generates a
     * string key for use in Map.
     */
    static Point = class {

        constructor(
            x,
            y
        ) {

            this.x =
                x;

            this.y =
                y;


            /*
             * Number is exact for the coordinate ranges expected
             * from browser images at this quantisation scale.
             */
            this.keyX =
                Math.round(
                    x *
                    MarchingSquares.KEY_SCALE
                );


            this.keyY =
                Math.round(
                    y *
                    MarchingSquares.KEY_SCALE
                );
        }


        /**
         * Return coordinate pair in the same logical format as
         * Java double[] { x, y }.
         */
        toArray() {

            return [
                this.x,
                this.y
            ];
        }


        /**
         * Quantised equality.
         */
        equals(
            other
        ) {

            if (
                this === other
            ) {

                return true;
            }


            if (
                !(other instanceof MarchingSquares.Point)
            ) {

                return false;
            }


            return (
                this.keyX ===
                other.keyX
                &&
                this.keyY ===
                other.keyY
            );
        }


        /**
         * Stable key for JavaScript Map.
         */
        getKey() {

            return (
                this.keyX +
                "," +
                this.keyY
            );
        }
    };


    /**
     * Internal contour segment.
     */
    static Segment = class {

        constructor(
            a,
            b
        ) {

            this.a =
                a;

            this.b =
                b;
        }


        /**
         * Return the endpoint opposite the supplied point.
         *
         * @returns {MarchingSquares.Point|null}
         */
        other(
            point
        ) {

            if (
                this.a.equals(
                    point
                )
            ) {

                return this.b;
            }


            if (
                this.b.equals(
                    point
                )
            ) {

                return this.a;
            }


            return null;
        }
    };
}