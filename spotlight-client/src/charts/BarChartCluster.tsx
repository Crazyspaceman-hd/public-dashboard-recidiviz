// Recidiviz - a data platform for criminal justice reform
// Copyright (C) 2022 Recidiviz, Inc.
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

import React, { useState, useCallback } from "react";
import OrdinalFrame from "semiotic/lib/OrdinalFrame";
import useBreakpoint from "@w11r/use-breakpoint";
import { animated, useTransition } from "react-spring/web.cjs";
import styled, { css } from "styled-components/macro";
import { ChartWrapper as BaseChartWrapper } from "@recidiviz/design-system";
import ColorLegend from "./ColorLegend";
import ResponsiveTooltipController, {
  ResponsiveTooltipControllerProps,
} from "./ResponsiveTooltipController";
import { highlightFade, useHighlightedItem } from "./utils";
import MeasureWidth from "../MeasureWidth";
import { animation, colors, zIndex } from "../UiLibrary";
import { format } from "d3-format";
import { RateByCategoryAndDemographicsRecords } from "../contentModels/types";

const CHART_HEIGHT = 400;
/**
 * Percent tick labels with just enough decimals for the visible range: "20%" at a
 * normal scale, "0.5%" or "0.05%" when hidden series zoom the axis in, instead of
 * rounding several ticks to the same label.
 */
export function pctTickFormatter(maxValue: number): (value: number) => string {
  // the chart draws about 3 ticks, so their spacing is roughly a third of the max
  const stepInPct = (maxValue * 100) / 3;
  const decimals =
    stepInPct > 0 ? Math.min(3, Math.max(0, -Math.floor(Math.log10(stepInPct)))) : 0;
  return format(`.${decimals}~%`);
}
const CHART_MIN_WIDTH = 736;

const Container = styled.figure`
  width: 100%;
`;

const horizontalScrollStyles = css`
  overflow-x: overlay !important;
  overflow-x: auto;
  overflow-y: hidden;
`;

const ChartWrapper = styled(BaseChartWrapper)<{
  isScrollable?: boolean;
  flatLabels?: boolean;
}>`
  position: relative;
  z-index: ${zIndex.base + 1};

  .foreground-graphics .ordinal-labels text {
    transform: ${(props) =>
      props.flatLabels ? "none" : "rotate(-45deg) translate(0rem, 0rem)"};
  }

  ${(props) => props.isScrollable && horizontalScrollStyles}

  .BarChartCluster__segment {
    stroke: ${colors.background};
    stroke-width: 2;
  }
`;

const Metadata = styled.figcaption`
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  padding-top: 4px;
  width: 100%;
  z-index: ${zIndex.base};
`;

const LegendWrapper = styled.div`
  /*
    setting a non-auto basis lets the legend try to wrap internally
    before the container wraps the entire legend to its own line
  */
  flex: 1 1 0;
  display: flex;
  justify-content: flex-end;
`;

/** One cluster: its label plus one value (0-1) per series named in `accessors`. */
export type BarChartClusterRecord =
  | RateByCategoryAndDemographicsRecords
  | ({ label: string } & Record<string, number | string>);

type BarChartClusterProps = {
  demographicView: string;
  data: BarChartClusterRecord[];
  accessors: string[];
  getTooltipProps: ResponsiveTooltipControllerProps["getTooltipProps"];
  /** short cluster labels: keep them horizontal and use less bottom margin */
  flatLabels?: boolean;
  /**
   * fixed color per series name; without it colors follow series position,
   * which shifts every color when a series is hidden
   */
  seriesColors?: Record<string, string>;
  /** set false when the caller renders its own legend (e.g. series toggles) */
  showLegend?: boolean;
};

/**
 * Renders bar chart with clusters of data by accessors
 */
export function BarChartCluster({
  demographicView,
  data,
  accessors,
  getTooltipProps,
  flatLabels = false,
  seriesColors,
  showLegend = true,
}: BarChartClusterProps): React.ReactElement {
  const colorOf = (name: string, index: number) =>
    seriesColors?.[name] ?? colors.dataViz[index];
  const isMobile = useBreakpoint(false, ["mobile-", true]);
  const chartTransitions = useTransition(
    // accessors travel with their data so a fading-out view keeps its own series
    { demographicView, data, accessors },
    (item) => item.demographicView,
    animation.crossFade
  );

  const { highlighted, setHighlighted } = useHighlightedItem();
  const [highlightedSegmentKey, setHighlightedSegmentKey] = useState();

  const setHighlightedSegment = useCallback(
    (d) => setHighlightedSegmentKey(d ? d.renderKey + 1 : undefined),
    [setHighlightedSegmentKey]
  );

  const itemsToDisplay = accessors.map((accessor, index) => {
    return {
      label: accessor,
      color: colorOf(accessor, index),
    };
  });

  return (
    <MeasureWidth>
      {({ measureRef, width }) => {
        const isScrollable = isMobile && width < 600;
        return (
          <Container
            ref={measureRef}
            // figure caption does not seem to get consistently picked up as accessible name
            aria-label={demographicView}
          >
            {width > 0 && (
              <>
                {chartTransitions.map(({ item, key, props }) => {
                  const maxValue = Math.max(
                    0,
                    ...item.data.flatMap((row) =>
                      item.accessors.map(
                        (a) => Number((row as Record<string, unknown>)[a]) || 0
                      )
                    )
                  );
                  return (
                  <ChartWrapper
                    key={key}
                    isScrollable={isScrollable}
                    flatLabels={flatLabels}
                  >
                    <animated.div style={props}>
                      <ResponsiveTooltipController
                        pieceHoverAnnotation
                        setHighlighted={setHighlightedSegment}
                        getTooltipProps={getTooltipProps}
                      >
                        <OrdinalFrame
                          baseMarkProps={{
                            transitionDuration: {
                              fill: animation.defaultDuration,
                            },
                          }}
                          data={item.data}
                          pieceClass="BarChartCluster__segment"
                          type="clusterbar"
                          oPadding={flatLabels ? 16 : 40}
                          margin={{
                            bottom: flatLabels ? 40 : 120,
                            left: 56,
                            right: 0,
                            top: 8,
                          }}
                          oAccessor="label"
                          // @ts-expect-error Semiotic typedefs are wrong,
                          // we can use label as string here
                          oLabel={(label: string) => (
                            <text textAnchor={flatLabels ? "middle" : "end"}>
                              {label}
                            </text>
                          )}
                          // @ts-expect-error Semiotic typedefs are wrong,
                          // we can use array of strings, when type of chart is "clusterbar"
                          rAccessor={item.accessors}
                          size={[
                            isScrollable ? CHART_MIN_WIDTH : width,
                            CHART_HEIGHT,
                          ]}
                          style={({ rName, rIndex, renderKey }) => {
                            const color = colorOf(rName, rIndex);
                            if (highlightedSegmentKey)
                              return {
                                fill:
                                  highlightedSegmentKey !== renderKey + 1
                                    ? highlightFade(color)
                                    : color,
                              };

                            return {
                              fill:
                                highlighted && highlighted.label !== rName
                                  ? highlightFade(color)
                                  : color,
                            };
                          }}
                          axes={[
                            {
                              baseline: false,
                              orient: "left",
                              tickFormat: pctTickFormatter(maxValue),
                              ticks: 3,
                              tickSize: 0,
                            },
                          ]}
                        />
                      </ResponsiveTooltipController>
                    </animated.div>
                  </ChartWrapper>
                  );
                })}
                {showLegend && (
                  <Metadata>
                    <LegendWrapper>
                      <ColorLegend
                        highlighted={highlighted}
                        items={itemsToDisplay}
                        setHighlighted={setHighlighted}
                      />
                    </LegendWrapper>
                  </Metadata>
                )}
              </>
            )}
          </Container>
        );
      }}
    </MeasureWidth>
  );
}
