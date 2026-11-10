// Recidiviz - a data platform for criminal justice reform
// Copyright (C) 2021 Recidiviz, Inc.
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

import useBreakpoint from "@w11r/use-breakpoint";
import { rem } from "polished";
import React, { useState } from "react";
import styled from "styled-components/macro";
import { ItemToHighlight, ProportionalBar } from ".";
import { DemographicCategoryRecords, Unknowns } from "../contentModels/types";
import VizControls, { VizControlsProps } from "../VizControls";
import VizNotes from "../VizNotes";

// short enough that the two bars sit close and their edges can be compared directly
const CHART_HEIGHT = 80;
const CHART_HEIGHT_MOBILE = 56;

const CHART_HEIGHT_PREVIEW = 420;
const CHART_HEIGHT_PREVIEW_MOBILE = 300;

const Wrapper = styled.div`
  padding: ${rem(48)} 0;
`;

const Spacer = styled.div`
  height: ${rem(24)};
`;

type BarChartPairProps = {
  data: DemographicCategoryRecords[];
  download?: () => void;
  filters?: VizControlsProps["filters"];
  methodology?: string;
  unknowns?: Unknowns;
  preview?: boolean;
};

export default function BarChartPair({
  data,
  download,
  filters,
  methodology,
  unknowns,
  preview,
}: BarChartPairProps): React.ReactElement {
  const [highlightedCategory, setHighlightedCategory] = useState<
    ItemToHighlight | undefined
  >();

  const chartHeight = useBreakpoint(CHART_HEIGHT, [
    "mobile-",
    CHART_HEIGHT_MOBILE,
  ]);

  const previewChartHeight = useBreakpoint(CHART_HEIGHT_PREVIEW, [
    "mobile-",
    CHART_HEIGHT_PREVIEW_MOBILE,
  ]);

  if (preview) {
    return (
      <>
        <ProportionalBar
          data={data[1].records}
          title={data[1].label}
          height={previewChartHeight}
          highlighted={highlightedCategory}
          setHighlighted={setHighlightedCategory}
          showLegend={preview}
          preview={preview}
        />
      </>
    );
  }

  return (
    <Wrapper>
      {filters && methodology && download && (
        <VizControls
          filters={filters}
          methodology={methodology}
          download={download}
          smallData={!preview}
        />
      )}
      {/* usually a pair, but any number of stages can be stacked (e.g. population,
          arrests, corrections); only the last bar carries the legend */}
      {data.map((series, index) => {
        const last = index === data.length - 1;
        return (
          <React.Fragment key={series.label}>
            {index > 0 && <Spacer />}
            <ProportionalBar
              data={series.records}
              title={series.label}
              height={chartHeight}
              highlighted={highlightedCategory}
              setHighlighted={last ? setHighlightedCategory : undefined}
              showLegend={last}
            />
          </React.Fragment>
        );
      })}
      {unknowns && <VizNotes unknowns={unknowns} download={download} />}
    </Wrapper>
  );
}
