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
 * Class: BezierPathFitter
 * --------------------------------------------------------------------
 *
 * BezierPathFitter converts ordered two-dimensional contour points into
 * compact SVG path data composed of straight line segments and cubic
 * Bezier curves.
 *
 * The class forms the curve-fitting stage of the PNG-to-SVG conversion
 * pipeline. Contours produced by Marching Squares and simplified by the
 * preceding contour-processing stage are analysed to distinguish sharp
 * corners from smooth sections. Sharp features are retained as SVG line
 * segments, while smooth portions are approximated using cubic Bezier
 * curves.
 *
 * Cubic curves are constructed using chord-length parameterisation,
 * estimated endpoint tangent directions and a least-squares solution for
 * the Bezier control-point distances. The resulting curve is compared
 * against the original contour points. If the fitting error exceeds the
 * requested tolerance, the section is divided at the point of greatest
 * error and recursively fitted as smaller sections.
 *
 * Both open and closed contours are supported. Closed contours are
 * divided around detected corners where possible; smooth closed shapes
 * without obvious corners are divided into multiple fitting sections to
 * avoid attempting to represent an entire loop with a single cubic
 * curve.
 *
 * SVG commands generated:
 *
 *     M  Move to beginning of contour
 *     L  Preserve straight sections and sharp features
 *     C  Represent smooth sections using cubic Bezier curves
 *     Z  Close closed contours
 *
 * --------------------------------------------------------------------
 */


class BezierPathFitter {

    /*
     * If the change in direction at a point exceeds this value,
     * that point is treated as a deliberate corner.
     *
     * Lower = preserve more corners.
     * Higher = allow more smoothing.
     */
    static DEFAULT_CORNER_ANGLE = 35.0;


    /*
     * Minimum number of points required before attempting a
     * cubic Bezier fit.
     */
    static MIN_CURVE_POINTS = 4;


    /*
     * Prevent pathological recursion on extremely complicated
     * contours.
     */
    static MAX_RECURSION_DEPTH = 20;


    // =========================================================
    // Public API
    // =========================================================

    /**
     * Fit a contour to SVG path data.
     *
     * Java provides overloaded fit(...) methods. JavaScript does
     * not support overloads in the same way, so cornerAngleDegrees
     * is optional and defaults to DEFAULT_CORNER_ANGLE.
     *
     * @param {Array<Array<number>>} points
     * @param {boolean} closed
     * @param {number} errorTolerance
     * @param {number} cornerAngleDegrees
     *
     * @returns {string|null}
     */
    static fit(
        points,
        closed,
        errorTolerance,
        cornerAngleDegrees =
            BezierPathFitter.DEFAULT_CORNER_ANGLE
    ) {

        if (
            points === null ||
            points === undefined ||
            points.length < 2
        ) {

            return null;
        }


        if (
            errorTolerance <= 0.0
        ) {

            errorTolerance =
                1.0;
        }


        let working =
            BezierPathFitter.removeConsecutiveDuplicates(
                points
            );


        if (
            working.length < 2
        ) {

            return null;
        }


        /*
         * Marching Squares may explicitly repeat the starting point
         * at the end of a closed contour.
         *
         * SVG Z will perform final closure.
         */
        if (
            closed &&
            working.length > 2 &&
            BezierPathFitter.samePoint(
                working[0],
                working[
                    working.length - 1
                ]
            )
        ) {

            working.pop();
        }


        if (
            working.length < 2
        ) {

            return null;
        }


        /*
         * Java uses StringBuilder.
         *
         * An array of command strings gives equivalent efficient
         * behaviour in JavaScript.
         */
        const svg =
            [];


        const first =
            working[0];


        svg.push(
            "M " +
            BezierPathFitter.format(
                first[0]
            ) +
            " " +
            BezierPathFitter.format(
                first[1]
            )
        );


        /*
         * Find points that should definitely remain sharp.
         */
        const corners =
            BezierPathFitter.findCorners(
                working,
                closed,
                cornerAngleDegrees
            );


        /*
         * Open paths always require their first and final points as
         * section boundaries.
         */
        if (
            !closed
        ) {

            if (
                !corners.includes(
                    0
                )
            ) {

                corners.push(
                    0
                );
            }


            const last =
                working.length - 1;


            if (
                !corners.includes(
                    last
                )
            ) {

                corners.push(
                    last
                );
            }


            corners.sort(
                (a, b) =>
                    a - b
            );


            BezierPathFitter.fitOpenSections(
                working,
                corners,
                errorTolerance,
                svg
            );

        } else {

            BezierPathFitter.fitClosedSections(
                working,
                corners,
                errorTolerance,
                svg
            );


            svg.push(
                "Z"
            );
        }


        return svg.join(
            " "
        );
    }


    // =========================================================
    // Section handling
    // =========================================================

    /**
     * Fit each section between corners in an open contour.
     */
    static fitOpenSections(
        points,
        corners,
        errorTolerance,
        svg
    ) {

        if (
            corners.length < 2
        ) {

            BezierPathFitter.fitSection(
                points,
                0,
                points.length - 1,
                errorTolerance,
                svg,
                0
            );


            return;
        }


        for (
            let i = 0;
            i < corners.length - 1;
            i++
        ) {

            const start =
                corners[i];


            const end =
                corners[
                    i + 1
                ];


            BezierPathFitter.fitSection(
                points,
                start,
                end,
                errorTolerance,
                svg,
                0
            );
        }
    }


    /**
     * Fit sections of a closed contour.
     */
    static fitClosedSections(
        points,
        corners,
        errorTolerance,
        svg
    ) {

        /*
         * No corners detected.
         *
         * Probably a smooth object such as a circle or O.
         *
         * Divide into quarters rather than attempting to represent
         * an entire loop with one cubic.
         */
        if (
            corners.length === 0
        ) {

            const n =
                points.length;


            if (
                n < 4
            ) {

                for (
                    let i = 1;
                    i < n;
                    i++
                ) {

                    BezierPathFitter.appendLine(
                        svg,
                        points[i]
                    );
                }


                return;
            }


            const quarter1 =
                Math.floor(
                    n / 4
                );


            const quarter2 =
                Math.floor(
                    n / 2
                );


            const quarter3 =
                Math.floor(
                    (3 * n) / 4
                );


            const artificialCorners =
                [
                    0,
                    quarter1,
                    quarter2,
                    quarter3
                ];


            BezierPathFitter.fitCircularSections(
                points,
                artificialCorners,
                errorTolerance,
                svg
            );


            return;
        }


        corners.sort(
            (a, b) =>
                a - b
        );


        /*
         * The M command has already been emitted for points[0].
         *
         * If zero is not a detected corner, include it as an
         * additional fitting boundary.
         */
        const boundaries =
            corners.slice();


        if (
            !boundaries.includes(
                0
            )
        ) {

            boundaries.push(
                0
            );


            boundaries.sort(
                (a, b) =>
                    a - b
            );
        }


        BezierPathFitter.fitCircularSections(
            points,
            boundaries,
            errorTolerance,
            svg
        );
    }


    /**
     * Fit between boundaries around a closed contour.
     */
    static fitCircularSections(
        points,
        boundaries,
        errorTolerance,
        svg
    ) {

        boundaries.sort(
            (a, b) =>
                a - b
        );


        for (
            let i = 0;
            i < boundaries.length - 1;
            i++
        ) {

            const start =
                boundaries[i];


            const end =
                boundaries[
                    i + 1
                ];


            BezierPathFitter.fitSection(
                points,
                start,
                end,
                errorTolerance,
                svg,
                0
            );
        }


        /*
         * Handle wrap-around from the final boundary back to
         * point zero.
         */
        const finalBoundary =
            boundaries[
                boundaries.length - 1
            ];


        if (
            finalBoundary <
            points.length - 1
        ) {

            const wrapped =
                [];


            for (
                let i = finalBoundary;
                i < points.length;
                i++
            ) {

                wrapped.push(
                    points[i]
                );
            }


            wrapped.push(
                points[0]
            );


            BezierPathFitter.fitSection(
                wrapped,
                0,
                wrapped.length - 1,
                errorTolerance,
                svg,
                0
            );
        }
    }


    // =========================================================
    // Recursive Bezier fitting
    // =========================================================

    /**
     * Attempt to fit one cubic Bezier to points[start..end].
     *
     * If the approximation error is too large, divide the contour
     * at the worst-fitting point and recursively fit both halves.
     */
    static fitSection(
        points,
        start,
        end,
        errorTolerance,
        svg,
        recursionDepth
    ) {

        const count =
            end -
            start +
            1;


        if (
            count <= 1
        ) {

            return;
        }


        /*
         * Two or three points do not contain enough information
         * for useful cubic fitting.
         */
        if (
            count <
            BezierPathFitter.MIN_CURVE_POINTS
            ||
            recursionDepth >=
            BezierPathFitter.MAX_RECURSION_DEPTH
        ) {

            BezierPathFitter.appendLines(
                points,
                start + 1,
                end,
                svg
            );


            return;
        }


        const p0 =
            points[start];


        const p3 =
            points[end];


        /*
         * Estimate endpoint tangents from neighbouring contour
         * points.
         */
        const startTangent =
            BezierPathFitter.normalize(
                BezierPathFitter.subtract(
                    points[
                        start + 1
                    ],
                    p0
                )
            );


        const endTangent =
            BezierPathFitter.normalize(
                BezierPathFitter.subtract(
                    points[
                        end - 1
                    ],
                    p3
                )
            );


        /*
         * Parameterise according to cumulative chord length.
         */
        const parameters =
            BezierPathFitter.chordLengthParameterize(
                points,
                start,
                end
            );


        /*
         * Solve for the two control-point distances.
         */
        const curve =
            BezierPathFitter.generateBezier(
                points,
                start,
                end,
                parameters,
                startTangent,
                endTangent
            );


        const error =
            BezierPathFitter.calculateMaximumError(
                points,
                start,
                end,
                curve,
                parameters
            );


        if (
            error.maxError <=
            errorTolerance
        ) {

            BezierPathFitter.appendCurve(
                svg,
                curve
            );


            return;
        }


        /*
         * Divide at the point with the greatest fitting error.
         */
        let split =
            error.splitIndex;


        /*
         * Safety fallback.
         */
        if (
            split <= start ||
            split >= end
        ) {

            split =
                start +
                Math.floor(
                    (end - start) /
                    2
                );
        }


        BezierPathFitter.fitSection(
            points,
            start,
            split,
            errorTolerance,
            svg,
            recursionDepth + 1
        );


        BezierPathFitter.fitSection(
            points,
            split,
            end,
            errorTolerance,
            svg,
            recursionDepth + 1
        );
    }


    // =========================================================
    // Cubic construction
    // =========================================================

    /**
     * Generate a least-squares cubic Bezier using fixed endpoint
     * tangent directions.
     */
    static generateBezier(
        points,
        start,
        end,
        parameters,
        startTangent,
        endTangent
    ) {

        const p0 =
            BezierPathFitter.copy(
                points[start]
            );


        const p3 =
            BezierPathFitter.copy(
                points[end]
            );


        let c00 =
            0.0;


        let c01 =
            0.0;


        let c11 =
            0.0;


        let x0 =
            0.0;


        let x1 =
            0.0;


        const count =
            end -
            start +
            1;


        for (
            let i = 0;
            i < count;
            i++
        ) {

            const t =
                parameters[i];


            const mt =
                1.0 -
                t;


            const b0 =
                mt *
                mt *
                mt;


            const b1 =
                3.0 *
                mt *
                mt *
                t;


            const b2 =
                3.0 *
                mt *
                t *
                t;


            const b3 =
                t *
                t *
                t;


            const a1 =
                BezierPathFitter.multiply(
                    startTangent,
                    b1
                );


            const a2 =
                BezierPathFitter.multiply(
                    endTangent,
                    b2
                );


            c00 +=
                BezierPathFitter.dot(
                    a1,
                    a1
                );


            c01 +=
                BezierPathFitter.dot(
                    a1,
                    a2
                );


            c11 +=
                BezierPathFitter.dot(
                    a2,
                    a2
                );


            const point =
                points[
                    start + i
                ];


            /*
             * Remove contribution from the fixed endpoints.
             */
            const baseX =
                (
                    b0 +
                    b1
                ) *
                p0[0]
                +
                (
                    b2 +
                    b3
                ) *
                p3[0];


            const baseY =
                (
                    b0 +
                    b1
                ) *
                p0[1]
                +
                (
                    b2 +
                    b3
                ) *
                p3[1];


            const residual =
                [
                    point[0] -
                    baseX,

                    point[1] -
                    baseY
                ];


            x0 +=
                BezierPathFitter.dot(
                    a1,
                    residual
                );


            x1 +=
                BezierPathFitter.dot(
                    a2,
                    residual
                );
        }


        const determinant =
            c00 *
            c11
            -
            c01 *
            c01;


        let alpha1;
        let alpha2;


        if (
            Math.abs(
                determinant
            ) >
            1e-12
        ) {

            alpha1 =
                (
                    x0 *
                    c11
                    -
                    x1 *
                    c01
                )
                /
                determinant;


            alpha2 =
                (
                    c00 *
                    x1
                    -
                    c01 *
                    x0
                )
                /
                determinant;

        } else {

            alpha1 =
                0.0;


            alpha2 =
                0.0;
        }


        /*
         * Negative or extremely small control distances usually
         * indicate an unstable fit.
         *
         * Fall back to one-third of the endpoint chord.
         */
        const chord =
            BezierPathFitter.distance(
                p0,
                p3
            );


        const fallback =
            chord /
            3.0;


        const minimumAlpha =
            chord *
            0.01;


        if (
            !Number.isFinite(
                alpha1
            )
            ||
            alpha1 <
            minimumAlpha
        ) {

            alpha1 =
                fallback;
        }


        if (
            !Number.isFinite(
                alpha2
            )
            ||
            alpha2 <
            minimumAlpha
        ) {

            alpha2 =
                fallback;
        }


        const p1 =
            BezierPathFitter.add(
                p0,
                BezierPathFitter.multiply(
                    startTangent,
                    alpha1
                )
            );


        const p2 =
            BezierPathFitter.add(
                p3,
                BezierPathFitter.multiply(
                    endTangent,
                    alpha2
                )
            );


        return new BezierPathFitter.CubicBezier(
            p0,
            p1,
            p2,
            p3
        );
    }


    // =========================================================
    // Error measurement
    // =========================================================

    static calculateMaximumError(
        points,
        start,
        end,
        curve,
        parameters
    ) {

        let maximum =
            0.0;


        let split =
            start +
            Math.floor(
                (end - start) /
                2
            );


        const count =
            end -
            start +
            1;


        for (
            let i = 1;
            i < count - 1;
            i++
        ) {

            const fitted =
                BezierPathFitter.evaluate(
                    curve,
                    parameters[i]
                );


            const actual =
                points[
                    start + i
                ];


            const error =
                BezierPathFitter.distance(
                    fitted,
                    actual
                );


            if (
                error >
                maximum
            ) {

                maximum =
                    error;


                split =
                    start + i;
            }
        }


        return new BezierPathFitter.ErrorResult(
            maximum,
            split
        );
    }


    /**
     * Evaluate a cubic Bezier at parameter t.
     */
    static evaluate(
        curve,
        t
    ) {

        const mt =
            1.0 -
            t;


        const b0 =
            mt *
            mt *
            mt;


        const b1 =
            3.0 *
            mt *
            mt *
            t;


        const b2 =
            3.0 *
            mt *
            t *
            t;


        const b3 =
            t *
            t *
            t;


        return [
            b0 * curve.p0[0]
            +
            b1 * curve.p1[0]
            +
            b2 * curve.p2[0]
            +
            b3 * curve.p3[0],

            b0 * curve.p0[1]
            +
            b1 * curve.p1[1]
            +
            b2 * curve.p2[1]
            +
            b3 * curve.p3[1]
        ];
    }


    // =========================================================
    // Parameterisation
    // =========================================================

    /**
     * Assign t values according to distance travelled along the
     * contour rather than simply using point index.
     */
    static chordLengthParameterize(
        points,
        start,
        end
    ) {

        const count =
            end -
            start +
            1;


        const parameters =
            new Float64Array(
                count
            );


        parameters[0] =
            0.0;


        for (
            let i = 1;
            i < count;
            i++
        ) {

            parameters[i] =
                parameters[
                    i - 1
                ]
                +
                BezierPathFitter.distance(
                    points[
                        start + i
                    ],
                    points[
                        start + i - 1
                    ]
                );
        }


        const total =
            parameters[
                count - 1
            ];


        if (
            total <=
            1e-12
        ) {

            for (
                let i = 0;
                i < count;
                i++
            ) {

                parameters[i] =
                    i /
                    (
                        count - 1
                    );
            }


            return parameters;
        }


        for (
            let i = 1;
            i < count;
            i++
        ) {

            parameters[i] /=
                total;
        }


        return parameters;
    }


    // =========================================================
    // Corner detection
    // =========================================================

    /**
     * Detect deliberate changes in contour direction.
     *
     * Straight continuation gives approximately 0 degrees.
     * A hard corner gives a larger angle.
     */
    static findCorners(
        points,
        closed,
        thresholdDegrees
    ) {

        const corners =
            [];


        if (
            points.length < 3
        ) {

            return corners;
        }


        const start =
            closed
                ? 0
                : 1;


        const end =
            closed
                ? points.length
                : points.length - 1;


        for (
            let i = start;
            i < end;
            i++
        ) {

            let previousIndex =
                i - 1;


            let nextIndex =
                i + 1;


            if (
                closed
            ) {

                if (
                    previousIndex < 0
                ) {

                    previousIndex =
                        points.length - 1;
                }


                if (
                    nextIndex >=
                    points.length
                ) {

                    nextIndex =
                        0;
                }
            }


            const previous =
                points[
                    previousIndex
                ];


            const current =
                points[i];


            const next =
                points[
                    nextIndex
                ];


            const angle =
                BezierPathFitter.turningAngle(
                    previous,
                    current,
                    next
                );


            if (
                angle >=
                thresholdDegrees
            ) {

                corners.push(
                    i
                );
            }
        }


        return corners;
    }


    static turningAngle(
        previous,
        current,
        next
    ) {

        const incoming =
            BezierPathFitter.normalize(
                BezierPathFitter.subtract(
                    current,
                    previous
                )
            );


        const outgoing =
            BezierPathFitter.normalize(
                BezierPathFitter.subtract(
                    next,
                    current
                )
            );


        let cosine =
            BezierPathFitter.dot(
                incoming,
                outgoing
            );


        cosine =
            Math.max(
                -1.0,
                Math.min(
                    1.0,
                    cosine
                )
            );


        return (
            Math.acos(
                cosine
            )
            *
            180.0
            /
            Math.PI
        );
    }


    // =========================================================
    // SVG output helpers
    // =========================================================

    static appendCurve(
        svg,
        curve
    ) {

        svg.push(
            "C " +
            BezierPathFitter.format(
                curve.p1[0]
            )
            +
            " " +
            BezierPathFitter.format(
                curve.p1[1]
            )
            +
            " " +
            BezierPathFitter.format(
                curve.p2[0]
            )
            +
            " " +
            BezierPathFitter.format(
                curve.p2[1]
            )
            +
            " " +
            BezierPathFitter.format(
                curve.p3[0]
            )
            +
            " " +
            BezierPathFitter.format(
                curve.p3[1]
            )
        );
    }


    static appendLine(
        svg,
        point
    ) {

        svg.push(
            "L " +
            BezierPathFitter.format(
                point[0]
            )
            +
            " " +
            BezierPathFitter.format(
                point[1]
            )
        );
    }


    static appendLines(
        points,
        start,
        end,
        svg
    ) {

        for (
            let i = start;
            i <= end;
            i++
        ) {

            BezierPathFitter.appendLine(
                svg,
                points[i]
            );
        }
    }


    static format(
        value
    ) {

        const rounded =
            Math.round(
                value
            );


        if (
            Math.abs(
                value -
                rounded
            ) <
            0.000001
        ) {

            return String(
                rounded
            );
        }


        /*
         * Java:
         *
         * String.format(Locale.US, "%.3f", value)
         *
         * followed by removal of trailing zeroes.
         */
        return value
            .toFixed(3)
            .replace(
                /0+$/,
                ""
            )
            .replace(
                /\.$/,
                ""
            );
    }


    // =========================================================
    // Vector maths
    // =========================================================

    static subtract(
        a,
        b
    ) {

        return [
            a[0] -
            b[0],

            a[1] -
            b[1]
        ];
    }


    static add(
        a,
        b
    ) {

        return [
            a[0] +
            b[0],

            a[1] +
            b[1]
        ];
    }


    static multiply(
        vector,
        scalar
    ) {

        return [
            vector[0] *
            scalar,

            vector[1] *
            scalar
        ];
    }


    static dot(
        a,
        b
    ) {

        return (
            a[0] *
            b[0]
            +
            a[1] *
            b[1]
        );
    }


    static normalize(
        vector
    ) {

        const length =
            Math.sqrt(
                vector[0] *
                vector[0]
                +
                vector[1] *
                vector[1]
            );


        if (
            length <=
            1e-12
        ) {

            return [
                0.0,
                0.0
            ];
        }


        return [
            vector[0] /
            length,

            vector[1] /
            length
        ];
    }


    static distance(
        a,
        b
    ) {

        const dx =
            a[0] -
            b[0];


        const dy =
            a[1] -
            b[1];


        return Math.sqrt(
            dx *
            dx
            +
            dy *
            dy
        );
    }


    static copy(
        point
    ) {

        return [
            point[0],
            point[1]
        ];
    }


    static samePoint(
        a,
        b
    ) {

        return (
            Math.abs(
                a[0] -
                b[0]
            ) <
            0.000001
            &&
            Math.abs(
                a[1] -
                b[1]
            ) <
            0.000001
        );
    }


    static removeConsecutiveDuplicates(
        points
    ) {

        const result =
            [];


        if (
            points.length === 0
        ) {

            return result;
        }


        result.push(
            BezierPathFitter.copy(
                points[0]
            )
        );


        for (
            let i = 1;
            i < points.length;
            i++
        ) {

            const point =
                points[i];


            const previous =
                result[
                    result.length - 1
                ];


            if (
                !BezierPathFitter.samePoint(
                    point,
                    previous
                )
            ) {

                result.push(
                    BezierPathFitter.copy(
                        point
                    )
                );
            }
        }


        return result;
    }


    // =========================================================
    // Internal data structures
    // =========================================================

    static CubicBezier = class {

        constructor(
            p0,
            p1,
            p2,
            p3
        ) {

            this.p0 =
                p0;


            this.p1 =
                p1;


            this.p2 =
                p2;


            this.p3 =
                p3;
        }
    };


    static ErrorResult = class {

        constructor(
            maxError,
            splitIndex
        ) {

            this.maxError =
                maxError;


            this.splitIndex =
                splitIndex;
        }
    };
}