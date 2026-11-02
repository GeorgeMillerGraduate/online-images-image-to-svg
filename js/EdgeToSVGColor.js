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
 * Class: EdgeToSVGColor
 * --------------------------------------------------------------------
 *
 * EdgeToSVGColor coordinates the conversion of raster images into
 * coloured SVG vector graphics.
 *
 * This JavaScript implementation mirrors the Java EdgeToSVGColor class
 * used by VectorForge. It combines Canny edge detection, Marching
 * Squares contour extraction, Ramer-Douglas-Peucker simplification,
 * Bezier fitting, region analysis, colour reconstruction and SVG
 * serialization.
 *
 * Processing pipeline:
 *
 *     Raster image
 *         -> Canny edge detection
 *         -> Marching Squares contour extraction
 *         -> contour limiting
 *         -> RDP simplification
 *         -> cubic Bezier fitting
 *         -> open / closed contour classification
 *         -> polygon and nesting analysis
 *         -> interior / stroke colour sampling
 *         -> SVG path generation
 *         -> SVG string
 *
 * Unlike the Java implementation, browser JavaScript cannot write
 * directly to an arbitrary filesystem path. Conversion therefore
 * returns the generated SVG document as a string. The webpage controller
 * can display that string or download it using a Blob.
 *
 * --------------------------------------------------------------------
 */


class EdgeToSVGColor {

    /*
     * RDP tolerance.
     */
    static SIMPLIFICATION_TOLERANCE = 0.03;


    /*
     * Bezier fitting tolerance.
     */
    static BEZIER_TOLERANCE = 0.1;


    /*
     * Very small regions are generally raster noise.
     */
    static MIN_REGION_AREA = 2.0;


    /*
     * Keep the original raster underneath during development.
     *
     * Set to false to inspect ONLY generated vector geometry.
     */
    static INCLUDE_RASTER_BASE = true;


    /*
     * Optional thin outlines around reconstructed regions.
     */
    static DRAW_REGION_OUTLINES = false;


    static REGION_STROKE_WIDTH = 0.25;


    static EPSILON = 0.000001;


    // =========================================================
    // Public conversion entry point
    // =========================================================

    /**
     * Convert an ImageHolder into coloured SVG.
     *
     * Browser equivalent of Java:
     *
     *     convertImageToColorEdgeSvg(...)
     *
     * @param {ImageHolder} original
     * @param {number} low
     * @param {number} high
     * @param {boolean} blur
     * @param {number} edgeThreshold
     * @param {number} stepLimitPerPath
     * @param {number} colorSampleStep
     * @param {string|null} rasterDataUrl
     *
     * @returns {string}
     */
    static convertImageToColorEdgeSvg(
        original,
        low,
        high,
        blur,
        edgeThreshold,
        stepLimitPerPath,
        colorSampleStep,
        rasterDataUrl = null
    ) {

        if (
            original === null ||
            original === undefined
        ) {

            throw new Error(
                "Original image cannot be null."
            );
        }


        /*
         * Preserve the known-good Java pipeline:
         *
         * ImageHolder -> binary Canny image -> Marching Squares.
         */
        const edges =
            CannyEdgeDetector.detect(
                original,
                low,
                high,
                blur
            );


        return EdgeToSVGColor.saveAsSvgColored(
            original,
            edges,
            edgeThreshold,
            stepLimitPerPath,
            colorSampleStep,
            rasterDataUrl
        );
    }


    // =========================================================
    // Contour processing
    // =========================================================

    /**
     * Process contours and return the complete SVG document.
     */
    static saveAsSvgColored(
        original,
        edgeImage,
        threshold,
        stepLimitPerPath,
        colorSampleStep,
        rasterDataUrl = null
    ) {

        const edgeData =
            edgeImage.getImage();


        const width =
            edgeData.width;


        const height =
            edgeData.height;


        /*
         * Extract subpixel contours.
         */
        const contours =
            MarchingSquares.trace(
                edgeImage,
                threshold
            );


        console.log(
            "Marching Squares contours found:",
            contours.length
        );


        const regions =
            [];


        const openPaths =
            [];


        for (
            const contour of
            contours
        ) {

            if (
                contour === null ||
                contour === undefined ||
                contour.length < 2
            ) {

                continue;
            }


            const limited =
                EdgeToSVGColor.limitContour(
                    contour,
                    stepLimitPerPath
                );


            if (
                limited.length < 2
            ) {

                continue;
            }


            const closed =
                EdgeToSVGColor.isClosed(
                    limited
                );


            const simplified =
                EdgeToSVGColor.simplifyPath(
                    limited,
                    EdgeToSVGColor.SIMPLIFICATION_TOLERANCE,
                    closed
                );


            if (
                simplified === null ||
                simplified === undefined ||
                simplified.length < 2
            ) {

                continue;
            }


            /*
             * BezierPathFitter.js will provide this method.
             */
            const pathData =
                BezierPathFitter.fit(
                    simplified,
                    closed,
                    EdgeToSVGColor.BEZIER_TOLERANCE
                );


            if (
                pathData === null ||
                pathData === undefined ||
                pathData.length < 8
            ) {

                continue;
            }


            /*
             * Open contours cannot represent filled regions.
             * Retain them as SVG strokes.
             */
            if (
                !closed ||
                simplified.length < 3
            ) {

                const rgb =
                    EdgeToSVGColor.averageStrokeColor(
                        original,
                        simplified,
                        colorSampleStep
                    );


                openPaths.push(
                    new EdgeToSVGColor.PathWithColor(
                        pathData,
                        rgb
                    )
                );


                continue;
            }


            const area =
                Math.abs(
                    EdgeToSVGColor.polygonArea(
                        simplified
                    )
                );


            if (
                area <
                EdgeToSVGColor.MIN_REGION_AREA
            ) {

                continue;
            }


            const interiorPoint =
                EdgeToSVGColor.findInteriorPoint(
                    simplified
                );


            const rgb =
                EdgeToSVGColor.sampleInteriorColor(
                    original,
                    simplified,
                    interiorPoint
                );


            regions.push(
                new EdgeToSVGColor.VectorRegion(
                    simplified,
                    pathData,
                    rgb,
                    area,
                    interiorPoint
                )
            );
        }


        /*
         * Large regions first.
         */
        regions.sort(
            (a, b) =>
                b.area -
                a.area
        );


        EdgeToSVGColor.determineNesting(
            regions
        );


        console.log(
            "Closed vector regions:",
            regions.length
        );


        console.log(
            "Open vector paths:",
            openPaths.length
        );


        return EdgeToSVGColor.writeSvgColored(
            width,
            height,
            regions,
            openPaths,
            rasterDataUrl
        );
    }


    // =========================================================
    // Data classes
    // =========================================================

    static PathWithColor = class {

        constructor(
            d,
            rgb
        ) {

            this.d =
                d;


            this.rgb =
                rgb;
        }
    };


    /**
     * Represents one closed vector region.
     */
    static VectorRegion = class {

        constructor(
            contour,
            d,
            rgb,
            area,
            interiorPoint
        ) {

            this.contour =
                contour;


            this.d =
                d;


            this.rgb =
                rgb;


            this.area =
                area;


            this.interiorPoint =
                interiorPoint;


            this.depth =
                0;
        }
    };


    // =========================================================
    // Contour limiting
    // =========================================================

    static limitContour(
        contour,
        limit
    ) {

        if (
            limit <= 0 ||
            contour.length <= limit
        ) {

            return contour;
        }


        /*
         * Match the current Java implementation exactly:
         * retain the first 'limit' points.
         */
        return contour.slice(
            0,
            limit
        );
    }


    // =========================================================
    // Region geometry
    // =========================================================

    /**
     * Shoelace formula.
     */
    static polygonArea(
        points
    ) {

        if (
            points === null ||
            points === undefined ||
            points.length < 3
        ) {

            return 0.0;
        }


        let area =
            0.0;


        for (
            let i = 0;
            i < points.length;
            i++
        ) {

            const current =
                points[i];


            const next =
                points[
                    (i + 1) %
                    points.length
                ];


            area +=
                current[0] *
                next[1]
                -
                next[0] *
                current[1];
        }


        return area *
            0.5;
    }


    /**
     * Find a point likely to lie inside the polygon.
     */
    static findInteriorPoint(
        contour
    ) {

        const centroid =
            EdgeToSVGColor.polygonCentroid(
                contour
            );


        if (
            EdgeToSVGColor.pointInsideContour(
                centroid[0],
                centroid[1],
                contour
            )
        ) {

            return centroid;
        }


        /*
         * Mean of all vertices.
         */
        let meanX =
            0.0;


        let meanY =
            0.0;


        for (
            const point of
            contour
        ) {

            meanX +=
                point[0];


            meanY +=
                point[1];
        }


        meanX /=
            contour.length;


        meanY /=
            contour.length;


        if (
            EdgeToSVGColor.pointInsideContour(
                meanX,
                meanY,
                contour
            )
        ) {

            return [
                meanX,
                meanY
            ];
        }


        /*
         * Try positions between the mean and vertices.
         */
        for (
            const point of
            contour
        ) {

            const x =
                meanX +
                (
                    point[0] -
                    meanX
                ) *
                0.25;


            const y =
                meanY +
                (
                    point[1] -
                    meanY
                ) *
                0.25;


            if (
                EdgeToSVGColor.pointInsideContour(
                    x,
                    y,
                    contour
                )
            ) {

                return [
                    x,
                    y
                ];
            }
        }


        /*
         * Final fallback.
         */
        const first =
            contour[0];


        return [
            first[0],
            first[1]
        ];
    }


    static polygonCentroid(
        points
    ) {

        const signedArea =
            EdgeToSVGColor.polygonArea(
                points
            );


        if (
            Math.abs(
                signedArea
            ) <
            EdgeToSVGColor.EPSILON
        ) {

            let x =
                0.0;


            let y =
                0.0;


            for (
                const point of
                points
            ) {

                x +=
                    point[0];


                y +=
                    point[1];
            }


            return [
                x / points.length,
                y / points.length
            ];
        }


        let cx =
            0.0;


        let cy =
            0.0;


        for (
            let i = 0;
            i < points.length;
            i++
        ) {

            const a =
                points[i];


            const b =
                points[
                    (i + 1) %
                    points.length
                ];


            const cross =
                a[0] *
                b[1]
                -
                b[0] *
                a[1];


            cx +=
                (
                    a[0] +
                    b[0]
                ) *
                cross;


            cy +=
                (
                    a[1] +
                    b[1]
                ) *
                cross;
        }


        const factor =
            1.0 /
            (
                6.0 *
                signedArea
            );


        return [
            cx * factor,
            cy * factor
        ];
    }


    /**
     * Standard even/odd ray-casting point-in-polygon test.
     */
    static pointInsideContour(
        x,
        y,
        contour
    ) {

        let inside =
            false;


        const count =
            contour.length;


        for (
            let i = 0,
                j = count - 1;
            i < count;
            j = i++
        ) {

            const pi =
                contour[i];


            const pj =
                contour[j];


            const crosses =
                (
                    pi[1] > y
                )
                !==
                (
                    pj[1] > y
                );


            if (
                !crosses
            ) {

                continue;
            }


            const intersectionX =
                (
                    pj[0] -
                    pi[0]
                )
                *
                (
                    y -
                    pi[1]
                )
                /
                (
                    pj[1] -
                    pi[1]
                )
                +
                pi[0];


            if (
                x <
                intersectionX
            ) {

                inside =
                    !inside;
            }
        }


        return inside;
    }


    // =========================================================
    // Nesting / holes
    // =========================================================

    /**
     * Calculate how many larger contours contain each region.
     */
    static determineNesting(
        regions
    ) {

        for (
            const region of
            regions
        ) {

            let depth =
                0;


            for (
                const possibleParent of
                regions
            ) {

                if (
                    possibleParent ===
                    region
                ) {

                    continue;
                }


                if (
                    possibleParent.area <=
                    region.area
                ) {

                    continue;
                }


                if (
                    EdgeToSVGColor.pointInsideContour(
                        region.interiorPoint[0],
                        region.interiorPoint[1],
                        possibleParent.contour
                    )
                ) {

                    depth++;
                }
            }


            region.depth =
                depth;
        }
    }


    // =========================================================
    // Interior colour sampling
    // =========================================================

    /**
     * Estimate the colour of a region rather than sampling its
     * antialiased boundary.
     */
    static sampleInteriorColor(
        original,
        contour,
        interiorPoint
    ) {

        const image =
            original.getImage();


        const width =
            image.width;


        const height =
            image.height;


        const pixels =
            image.data;


        const centreX =
            EdgeToSVGColor.clamp(
                Math.round(
                    interiorPoint[0]
                ),
                0,
                width - 1
            );


        const centreY =
            EdgeToSVGColor.clamp(
                Math.round(
                    interiorPoint[1]
                ),
                0,
                height - 1
            );


        let redTotal =
            0;


        let greenTotal =
            0;


        let blueTotal =
            0;


        let count =
            0;


        /*
         * Match Java radius.
         */
        const radius =
            2;


        for (
            let dy = -radius;
            dy <= radius;
            dy++
        ) {

            for (
                let dx = -radius;
                dx <= radius;
                dx++
            ) {

                const x =
                    centreX +
                    dx;


                const y =
                    centreY +
                    dy;


                if (
                    x < 0 ||
                    x >= width ||
                    y < 0 ||
                    y >= height
                ) {

                    continue;
                }


                if (
                    !EdgeToSVGColor.pointInsideContour(
                        x + 0.5,
                        y + 0.5,
                        contour
                    )
                ) {

                    continue;
                }


                const index =
                    (
                        y * width +
                        x
                    ) *
                    4;


                const alpha =
                    pixels[
                        index + 3
                    ];


                if (
                    alpha < 16
                ) {

                    continue;
                }


                redTotal +=
                    pixels[index];


                greenTotal +=
                    pixels[
                        index + 1
                    ];


                blueTotal +=
                    pixels[
                        index + 2
                    ];


                count++;
            }
        }


        /*
         * Fallback to the candidate point itself.
         */
        if (
            count === 0
        ) {

            const index =
                (
                    centreY *
                    width +
                    centreX
                ) *
                4;


            return EdgeToSVGColor.packRGB(
                pixels[index],
                pixels[index + 1],
                pixels[index + 2]
            );
        }


        const red =
            Math.floor(
                redTotal /
                count
            );


        const green =
            Math.floor(
                greenTotal /
                count
            );


        const blue =
            Math.floor(
                blueTotal /
                count
            );


        return EdgeToSVGColor.packRGB(
            red,
            green,
            blue
        );
    }


    // =========================================================
    // RDP simplification
    // =========================================================

    static simplifyPath(
        points,
        epsilon,
        closed
    ) {

        if (
            points === null ||
            points === undefined ||
            points.length < 3
        ) {

            return points;
        }


        const working =
            points.slice();


        /*
         * Remove duplicate endpoint before RDP.
         */
        if (
            closed &&
            working.length > 1 &&
            EdgeToSVGColor.samePoint(
                working[0],
                working[
                    working.length - 1
                ]
            )
        ) {

            working.pop();
        }


        if (
            working.length < 3
        ) {

            return working;
        }


        if (
            closed
        ) {

            return EdgeToSVGColor.simplifyClosedPath(
                working,
                epsilon
            );
        }


        return EdgeToSVGColor.simplifyOpenPath(
            working,
            epsilon
        );
    }


    static simplifyOpenPath(
        points,
        epsilon
    ) {

        if (
            points.length < 3
        ) {

            return points.slice();
        }


        const keep =
            new Uint8Array(
                points.length
            );


        keep[0] =
            1;


        keep[
            points.length - 1
        ] =
            1;


        EdgeToSVGColor.simplifySection(
            points,
            0,
            points.length - 1,
            epsilon,
            keep
        );


        const result =
            [];


        for (
            let i = 0;
            i < points.length;
            i++
        ) {

            if (
                keep[i] !== 0
            ) {

                result.push(
                    points[i]
                );
            }
        }


        return result;
    }


    static simplifyClosedPath(
        points,
        epsilon
    ) {

        if (
            points.length < 4
        ) {

            return points.slice();
        }


        let splitIndex =
            EdgeToSVGColor.findFarthestPoint(
                points,
                points[0]
            );


        if (
            splitIndex <= 0 ||
            splitIndex >=
            points.length - 1
        ) {

            splitIndex =
                Math.floor(
                    points.length /
                    2
                );
        }


        const firstHalf =
            [];


        for (
            let i = 0;
            i <= splitIndex;
            i++
        ) {

            firstHalf.push(
                points[i]
            );
        }


        const secondHalf =
            [];


        for (
            let i = splitIndex;
            i < points.length;
            i++
        ) {

            secondHalf.push(
                points[i]
            );
        }


        secondHalf.push(
            points[0]
        );


        const simplifiedFirst =
            EdgeToSVGColor.simplifyOpenPath(
                firstHalf,
                epsilon
            );


        const simplifiedSecond =
            EdgeToSVGColor.simplifyOpenPath(
                secondHalf,
                epsilon
            );


        const result =
            simplifiedFirst.slice();


        for (
            let i = 1;
            i <
            simplifiedSecond.length - 1;
            i++
        ) {

            result.push(
                simplifiedSecond[i]
            );
        }


        return result;
    }


    static findFarthestPoint(
        points,
        origin
    ) {

        let maxDistance =
            -1.0;


        let maxIndex =
            -1;


        for (
            let i = 1;
            i < points.length;
            i++
        ) {

            const dx =
                points[i][0] -
                origin[0];


            const dy =
                points[i][1] -
                origin[1];


            const distanceSquared =
                dx * dx +
                dy * dy;


            if (
                distanceSquared >
                maxDistance
            ) {

                maxDistance =
                    distanceSquared;


                maxIndex =
                    i;
            }
        }


        return maxIndex;
    }


    static simplifySection(
        points,
        start,
        end,
        epsilon,
        keep
    ) {

        if (
            end <=
            start + 1
        ) {

            return;
        }


        const a =
            points[start];


        const b =
            points[end];


        let maxDistance =
            -1.0;


        let maxIndex =
            -1;


        for (
            let i = start + 1;
            i < end;
            i++
        ) {

            const distance =
                EdgeToSVGColor.perpendicularDistance(
                    points[i],
                    a,
                    b
                );


            if (
                distance >
                maxDistance
            ) {

                maxDistance =
                    distance;


                maxIndex =
                    i;
            }
        }


        if (
            maxIndex !== -1 &&
            maxDistance > epsilon
        ) {

            keep[
                maxIndex
            ] =
                1;


            EdgeToSVGColor.simplifySection(
                points,
                start,
                maxIndex,
                epsilon,
                keep
            );


            EdgeToSVGColor.simplifySection(
                points,
                maxIndex,
                end,
                epsilon,
                keep
            );
        }
    }


    static perpendicularDistance(
        point,
        lineStart,
        lineEnd
    ) {

        const dx =
            lineEnd[0] -
            lineStart[0];


        const dy =
            lineEnd[1] -
            lineStart[1];


        if (
            Math.abs(dx) <
            EdgeToSVGColor.EPSILON
            &&
            Math.abs(dy) <
            EdgeToSVGColor.EPSILON
        ) {

            const px =
                point[0] -
                lineStart[0];


            const py =
                point[1] -
                lineStart[1];


            return Math.hypot(
                px,
                py
            );
        }


        const numerator =
            Math.abs(
                dy *
                point[0]
                -
                dx *
                point[1]
                +
                lineEnd[0] *
                lineStart[1]
                -
                lineEnd[1] *
                lineStart[0]
            );


        return numerator /
            Math.hypot(
                dx,
                dy
            );
    }


    // =========================================================
    // Path utilities
    // =========================================================

    /**
     * Useful fallback/debug path generator.
     */
    static pointsToPath(
        points,
        close
    ) {

        if (
            points === null ||
            points === undefined ||
            points.length < 2
        ) {

            return null;
        }


        const first =
            points[0];


        let result =
            "M " +
            EdgeToSVGColor.format(
                first[0]
            )
            +
            " " +
            EdgeToSVGColor.format(
                first[1]
            );


        for (
            let i = 1;
            i < points.length;
            i++
        ) {

            const point =
                points[i];


            const previous =
                points[
                    i - 1
                ];


            if (
                EdgeToSVGColor.samePoint(
                    point,
                    previous
                )
            ) {

                continue;
            }


            result +=
                " L " +
                EdgeToSVGColor.format(
                    point[0]
                )
                +
                " " +
                EdgeToSVGColor.format(
                    point[1]
                );
        }


        if (
            close
        ) {

            result +=
                " Z";
        }


        return result;
    }


    static isClosed(
        points
    ) {

        if (
            points === null ||
            points === undefined ||
            points.length < 3
        ) {

            return false;
        }


        return EdgeToSVGColor.samePoint(
            points[0],
            points[
                points.length - 1
            ]
        );
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
            EdgeToSVGColor.EPSILON
            &&
            Math.abs(
                a[1] -
                b[1]
            ) <
            EdgeToSVGColor.EPSILON
        );
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
            EdgeToSVGColor.EPSILON
        ) {

            return String(
                rounded
            );
        }


        /*
         * Java used %.2f followed by removal of trailing zeros.
         */
        return value
            .toFixed(2)
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
    // Existing edge colour sampling
    // =========================================================

    static averageStrokeColor(
        original,
        points,
        step
    ) {

        if (
            step < 1
        ) {

            step =
                1;
        }


        let redTotal =
            0;


        let greenTotal =
            0;


        let blueTotal =
            0;


        let count =
            0;


        const image =
            original.getImage();


        const width =
            image.width;


        const height =
            image.height;


        const pixels =
            image.data;


        for (
            let i = 0;
            i < points.length;
            i += step
        ) {

            const point =
                points[i];


            const x =
                Math.round(
                    point[0]
                );


            const y =
                Math.round(
                    point[1]
                );


            if (
                x < 0 ||
                x >= width ||
                y < 0 ||
                y >= height
            ) {

                continue;
            }


            const index =
                (
                    y * width +
                    x
                ) *
                4;


            const alpha =
                pixels[
                    index + 3
                ];


            if (
                alpha < 16
            ) {

                continue;
            }


            redTotal +=
                pixels[index];


            greenTotal +=
                pixels[
                    index + 1
                ];


            blueTotal +=
                pixels[
                    index + 2
                ];


            count++;
        }


        if (
            count === 0
        ) {

            return 0xFFFFFF;
        }


        const red =
            Math.floor(
                redTotal /
                count
            );


        const green =
            Math.floor(
                greenTotal /
                count
            );


        const blue =
            Math.floor(
                blueTotal /
                count
            );


        return EdgeToSVGColor.packRGB(
            red,
            green,
            blue
        );
    }


    // =========================================================
    // SVG writer
    // =========================================================

    /**
     * Build and return the complete SVG document.
     *
     * Java wrote this content using BufferedWriter.
     * Browser JavaScript returns it as a string instead.
     */
    static writeSvgColored(
        width,
        height,
        regions,
        openPaths,
        rasterDataUrl = null
    ) {

        const output =
            [];


        output.push(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        );


        output.push(
            "<svg " +
            "xmlns=\"http://www.w3.org/2000/svg\" " +
            "xmlns:xlink=\"http://www.w3.org/1999/xlink\" " +
            "width=\"" + width + "\" " +
            "height=\"" + height + "\" " +
            "viewBox=\"0 0 " +
            width + " " +
            height + "\">"
        );


        /*
         * Optional raster comparison layer.
         *
         * rasterDataUrl should normally look like:
         *
         * data:image/png;base64,...
         */
        if (
            EdgeToSVGColor.INCLUDE_RASTER_BASE &&
            rasterDataUrl !== null &&
            rasterDataUrl !== undefined &&
            rasterDataUrl.length > 0
        ) {

            output.push(
                "  <image " +
                "x=\"0\" " +
                "y=\"0\" " +
                "width=\"" + width + "\" " +
                "height=\"" + height + "\" " +
                "href=\"" +
                EdgeToSVGColor.escapeXmlAttribute(
                    rasterDataUrl
                ) +
                "\"/>"
            );
        }


        /*
         * Closed regions.
         */
        output.push(
            "  <g fill-rule=\"evenodd\">"
        );


        for (
            const region of
            regions
        ) {

            if (
                region === null ||
                region === undefined ||
                region.d === null ||
                region.d === undefined ||
                region.d.length < 8
            ) {

                continue;
            }


            const red =
                (
                    region.rgb >>>
                    16
                ) &
                0xFF;


            const green =
                (
                    region.rgb >>>
                    8
                ) &
                0xFF;


            const blue =
                region.rgb &
                0xFF;


            let path =
                "    <path d=\"" +
                EdgeToSVGColor.escapeXmlAttribute(
                    region.d
                ) +
                "\" fill=\"rgb(" +
                red + "," +
                green + "," +
                blue +
                ")\"";


            if (
                EdgeToSVGColor.DRAW_REGION_OUTLINES
            ) {

                path +=
                    " stroke=\"rgb(" +
                    red + "," +
                    green + "," +
                    blue +
                    ")\"" +
                    " stroke-width=\"" +
                    EdgeToSVGColor.REGION_STROKE_WIDTH +
                    "\"" +
                    " stroke-linejoin=\"round\"" +
                    " stroke-linecap=\"round\"";

            } else {

                path +=
                    " stroke=\"none\"";
            }


            path +=
                "/>";


            output.push(
                path
            );
        }


        output.push(
            "  </g>"
        );


        /*
         * Open contours remain SVG strokes.
         */
        if (
            openPaths.length > 0
        ) {

            output.push(
                "  <g fill=\"none\" " +
                "stroke-width=\"0.25\" " +
                "stroke-linecap=\"round\" " +
                "stroke-linejoin=\"round\">"
            );


            for (
                const path of
                openPaths
            ) {

                if (
                    path === null ||
                    path === undefined ||
                    path.d === null ||
                    path.d === undefined ||
                    path.d.length < 8
                ) {

                    continue;
                }


                const red =
                    (
                        path.rgb >>>
                        16
                    ) &
                    0xFF;


                const green =
                    (
                        path.rgb >>>
                        8
                    ) &
                    0xFF;


                const blue =
                    path.rgb &
                    0xFF;


                output.push(
                    "    <path d=\"" +
                    EdgeToSVGColor.escapeXmlAttribute(
                        path.d
                    ) +
                    "\" stroke=\"rgb(" +
                    red + "," +
                    green + "," +
                    blue +
                    ")\"/>"
                );
            }


            output.push(
                "  </g>"
            );
        }


        output.push(
            "</svg>"
        );


        return output.join(
            "\n"
        );
    }


    // =========================================================
    // Browser helpers
    // =========================================================

    /**
     * Convert a browser File/Blob into a data URL.
     *
     * This is only needed if INCLUDE_RASTER_BASE is enabled.
     */
    static blobToDataUrl(
        blob
    ) {

        return new Promise(
            (resolve, reject) => {

                const reader =
                    new FileReader();


                reader.onload =
                    () => {

                        resolve(
                            reader.result
                        );
                    };


                reader.onerror =
                    () => {

                        reject(
                            new Error(
                                "Could not read raster image."
                            )
                        );
                    };


                reader.readAsDataURL(
                    blob
                );
            }
        );
    }


    /**
     * Escape values inserted into XML attributes.
     */
    static escapeXmlAttribute(
        value
    ) {

        return String(
            value
        )
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            );
    }


    // =========================================================
    // Miscellaneous
    // =========================================================

    static clamp(
        value,
        minimum,
        maximum
    ) {

        return Math.max(
            minimum,
            Math.min(
                maximum,
                value
            )
        );
    }


    /**
     * Pack RGB components into the same 0xRRGGBB integer format
     * used by the Java implementation.
     */
    static packRGB(
        red,
        green,
        blue
    ) {

        return (
            (
                red &
                0xFF
            ) <<
            16
        )
        |
        (
            (
                green &
                0xFF
            ) <<
            8
        )
        |
        (
            blue &
            0xFF
        );
    }
}