// Recidiviz - a data platform for criminal justice reform
// Copyright (C) 2026 Recidiviz, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
// =============================================================================

import { scaleLinear } from "d3-scale";
import { rem } from "polished";
import React from "react";
import styled from "styled-components/macro";
import type { PooledRecidivismPoint } from "../contentModels/RecidivismRateMetric";
import MeasureWidth from "../MeasureWidth";
import { colors } from "../UiLibrary";
import { formatAsNumber, formatAsPct } from "../utils";
import { pctTickFormatter } from "./BarChartCluster";

export const RECIDIVISM_CURVE_HEIGHT = 360;
const MARGIN = { top: 28, right: 28, bottom: 44, left: 52 };
/** follow-up years that get their value written on the chart */
const LABELED_YEARS = [1, 3, 5, 10];

const LINE_COLOR = colors.dataViz[0];

const Figure = styled.figure`
  margin: 0;
  width: 100%;
`;

const Svg = styled.svg`
  display: block;
  font-size: 12px;
  overflow: visible;

  .grid line {
    stroke: ${colors.chartGridLine};
  }

  .tick text,
  .axis-title {
    fill: ${colors.caption};
  }

  .value-label {
    fill: ${colors.text};
    font-size: 13px;
    font-weight: 600;
  }
`;

const Key = styled.figcaption`
  color: ${colors.caption};
  display: flex;
  flex-wrap: wrap;
  font-size: ${rem(13)};
  gap: ${rem(4)} ${rem(20)};
  margin-top: ${rem(8)};
  padding-left: ${MARGIN.left}px;
`;

const KeyItem = styled.span`
  align-items: center;
  display: inline-flex;
`;

const LineSwatch = styled.span`
  background: ${LINE_COLOR};
  display: inline-block;
  height: 3px;
  margin-right: ${rem(6)};
  width: ${rem(18)};
`;

const BandSwatch = styled.span`
  background: ${LINE_COLOR};
  display: inline-block;
  height: ${rem(10)};
  margin-right: ${rem(6)};
  opacity: 0.18;
  width: ${rem(18)};
`;

const DEFAULT_VALUE_LABEL = "Share of people back in prison";

const yearsLabel = (n: number) => `${n} year${n === 1 ? "" : "s"}`;

function cohortRange(cohorts: number[]) {
  if (!cohorts.length) return "";
  const first = cohorts[0];
  const last = cohorts[cohorts.length - 1];
  return first === last ? `${first}` : `${first}–${last}`;
}

/** Plain-language summary used as the chart's accessible name. */
export function describeCurve(
  points: PooledRecidivismPoint[],
  valueLabel = DEFAULT_VALUE_LABEL
): string {
  const parts = points
    .filter((p) => LABELED_YEARS.includes(p.followupYears))
    .map((p) => `${formatAsPct(p.rate)} within ${yearsLabel(p.followupYears)}`);
  return `${valueLabel} after release: ${parts.join(", ")}.`;
}

/**
 * A single cumulative recidivism curve (all release years combined, weighted by
 * releases) over a shaded band showing the lowest and highest individual release
 * year. Key values are written on the chart, and the y-axis fits the data.
 */
const RecidivismCurve: React.FC<{
  data: PooledRecidivismPoint[];
  /** what the y-axis measures, e.g. "Share of people back on supervision" */
  valueLabel?: string;
}> = ({ data, valueLabel = DEFAULT_VALUE_LABEL }) => {
  const lastPoint = data[data.length - 1];
  const maxYears = lastPoint?.followupYears ?? 0;
  const maxValue = Math.max(0, ...data.map((p) => p.max));

  return (
    <MeasureWidth>
      {({ measureRef, width }) => {
        const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
        const innerHeight =
          RECIDIVISM_CURVE_HEIGHT - MARGIN.top - MARGIN.bottom;
        const x = scaleLinear()
          .domain([0, Math.max(1, maxYears)])
          .range([0, innerWidth]);
        // reactive upper bound: a little headroom above the data, on a nice number
        const y = scaleLinear()
          .domain([0, Math.max(0.05, maxValue * 1.08)])
          .range([innerHeight, 0])
          .nice(5);
        const yTicks = y.ticks(5);
        const formatTick = pctTickFormatter(y.domain()[1] * 0.75);

        const linePath = data
          .map((p, i) => `${i ? "L" : "M"}${x(p.followupYears)},${y(p.rate)}`)
          .join("");
        const bandPath = `${data
          .map((p, i) => `${i ? "L" : "M"}${x(p.followupYears)},${y(p.max)}`)
          .join("")}${[...data]
          .reverse()
          .map((p) => `L${x(p.followupYears)},${y(p.min)}`)
          .join("")}Z`;

        const labeled = data.filter(
          (p) =>
            LABELED_YEARS.includes(p.followupYears) ||
            (p === lastPoint && p.followupYears > 0)
        );

        return (
          <Figure ref={measureRef}>
            {width > 0 && (
              <Svg
                width={width}
                height={RECIDIVISM_CURVE_HEIGHT}
                role="img"
                aria-label={describeCurve(data, valueLabel)}
              >
                <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                  <text className="axis-title" x={-MARGIN.left} y={-12}>
                    {valueLabel}
                  </text>
                  <g className="grid">
                    {yTicks.map((t) => (
                      <g key={t} className="tick" transform={`translate(0,${y(t)})`}>
                        <line x2={innerWidth} />
                        <text x={-8} dy="0.32em" textAnchor="end">
                          {formatTick(t)}
                        </text>
                      </g>
                    ))}
                  </g>
                  <g transform={`translate(0,${innerHeight})`}>
                    {data.map((p) => (
                      <g
                        key={p.followupYears}
                        className="tick"
                        transform={`translate(${x(p.followupYears)},0)`}
                      >
                        <text y={18} textAnchor="middle">
                          {p.followupYears}
                        </text>
                      </g>
                    ))}
                    <text
                      className="axis-title"
                      x={innerWidth / 2}
                      y={38}
                      textAnchor="middle"
                    >
                      Years since release
                    </text>
                  </g>
                  <path d={bandPath} fill={LINE_COLOR} opacity={0.18} />
                  <path
                    d={linePath}
                    fill="none"
                    stroke={LINE_COLOR}
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                  {data
                    .filter((p) => p.followupYears > 0)
                    .map((p) => (
                      <circle
                        key={p.followupYears}
                        cx={x(p.followupYears)}
                        cy={y(p.rate)}
                        r={4}
                        fill={LINE_COLOR}
                      >
                        <title>
                          {`Within ${yearsLabel(p.followupYears)}: ${formatAsPct(
                            p.rate
                          )} (${formatAsNumber(p.returned)} of ${formatAsNumber(
                            p.releases
                          )} releases, release years ${cohortRange(
                            p.cohorts
                          )}; single years ranged ${formatAsPct(
                            p.min
                          )}–${formatAsPct(p.max)})`}
                        </title>
                      </circle>
                    ))}
                  {labeled.map((p) => (
                    <text
                      key={p.followupYears}
                      className="value-label"
                      x={x(p.followupYears)}
                      y={y(p.max) - 10}
                      textAnchor={p === lastPoint ? "end" : "middle"}
                    >
                      {formatAsPct(p.rate)}
                    </text>
                  ))}
                </g>
              </Svg>
            )}
            <Key>
              <KeyItem>
                <LineSwatch aria-hidden />
                All release years combined
                {lastPoint ? ` (${cohortRange(data[0].cohorts)})` : ""}
              </KeyItem>
              <KeyItem>
                <BandSwatch aria-hidden />
                Range of individual release years
              </KeyItem>
              {lastPoint && lastPoint.cohorts.length < data[0].cohorts.length && (
                <KeyItem>
                  Later years include only the release years followed that
                  long ({yearsLabel(maxYears)}: {cohortRange(lastPoint.cohorts)}).
                </KeyItem>
              )}
            </Key>
          </Figure>
        );
      }}
    </MeasureWidth>
  );
};

export default RecidivismCurve;
