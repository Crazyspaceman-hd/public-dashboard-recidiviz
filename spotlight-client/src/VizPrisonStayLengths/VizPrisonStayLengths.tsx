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

import { sum } from "d3-array";
import { observer } from "mobx-react-lite";
import { rem } from "polished";
import React from "react";
import { animated, useTransition } from "react-spring/web.cjs";
import styled from "styled-components/macro";
import {
  CommonDataPoint,
  BarChartTrellis,
  singleChartHeight,
  TooltipContentFunction,
} from "../charts";
import {
  BarChartCluster,
  BarChartClusterRecord,
} from "../charts/BarChartCluster";
import SeriesToggles, {
  seriesColorMap,
  useHiddenSeries,
} from "../charts/SeriesToggles";
import DemographicsByCategoryMetric from "../contentModels/DemographicsByCategoryMetric";
import { DemographicCategoryRecords } from "../contentModels/types";
import DemographicFilterSelect from "../DemographicFilterSelect";
import MetricVizControls from "../MetricVizControls";
import { prisonStayLengthFields } from "../metricsApi";
import { animation, AutoHeightTransition, colors } from "../UiLibrary";
import withMetricHydrator from "../withMetricHydrator";
import VizNotes from "../VizNotes";

const ChartsWrapper = styled.div`
  position: relative;
`;

const ClusterNote = styled.p`
  color: ${colors.caption};
  font-size: ${rem(13)};
  margin-top: ${rem(8)};
`;

// the first category already includes "year"; the rest are bare ranges
const stayLengthTitle = (label: string) =>
  label !== prisonStayLengthFields[0].categoryLabel ? `${label} years` : label;

/**
 * Turns per-group stay-length counts into grouped-column rows where every value is
 * that group's share of all releases across the groups shown (not of the group's own
 * releases), so a stay length's columns sum to its overall share.
 */
export function toShareOfAllReleases(
  dataSeries: DemographicCategoryRecords[]
): BarChartClusterRecord[] {
  const allReleases = sum(
    dataSeries.flatMap(({ records }) => records.map(({ value }) => value))
  );
  return prisonStayLengthFields.map(({ categoryLabel }) => {
    const row: BarChartClusterRecord = { label: categoryLabel };
    dataSeries.forEach(({ label, records }) => {
      const count = records.find((r) => r.label === categoryLabel)?.value ?? 0;
      row[label] = allReleases ? count / allReleases : 0;
    });
    return row;
  });
}

const getTooltipProps: TooltipContentFunction = (columnData) => {
  const {
    summary: [
      {
        data: { label, pct, value },
      },
    ],
  } = columnData as {
    // can't find any Semiotic type definition that describes what is actually
    // passed to this function, but the part we care about looks like this
    summary: { data: CommonDataPoint }[];
  };

  return {
    title: `${label}${
      // special case: the first category already has "year" in it
      label !== prisonStayLengthFields[0].categoryLabel ? " years" : ""
    }`,
    records: [
      {
        pct,
        value,
      },
    ],
  };
};

type VizPrisonStayLengthsProps = {
  metric: DemographicsByCategoryMetric;
};

const VizPrisonStayLengths: React.FC<VizPrisonStayLengthsProps> = ({
  metric,
}) => {
  const { dataSeries, demographicView, unknowns } = metric;

  // groups the reader has unchecked; every group is shown again on a new view
  const [hiddenGroups, toggleGroup] = useHiddenSeries(demographicView);

  const chartTransitions = useTransition(
    { demographicView, dataSeries },
    (item) => item.demographicView,
    animation.crossFade
  );

  if (demographicView === "nofilter")
    throw new Error(
      "Unable to display this metric without demographic filter."
    );

  if (dataSeries && demographicView !== "total") {
    // one cluster per stay length, one column per demographic group; every column is
    // that group's share of ALL releases, so column heights reflect real counts
    const groups = dataSeries.map(({ label }) => label);
    // shares stay relative to ALL releases even when groups are hidden; hiding a
    // big group only rescales the axis so the small groups become readable
    const clusters = toShareOfAllReleases(dataSeries);
    const visibleGroups = groups.filter((g) => !hiddenGroups.includes(g));
    const seriesColors = seriesColorMap(groups);
    const groupTotals = Object.fromEntries(
      dataSeries.map(({ label, records }) => [
        label,
        sum(records, ({ value }) => value),
      ])
    );

    const getClusterTooltipProps: TooltipContentFunction = (columnData) => {
      const group = String(columnData.rName);
      const row = columnData.data as BarChartClusterRecord;
      const stayLength = String(row.label);
      const count =
        dataSeries
          .find(({ label }) => label === group)
          ?.records.find(({ label }) => label === stayLength)?.value ?? 0;
      return {
        title: `${group}: ${stayLengthTitle(stayLength)}`,
        records: [{ pct: Number(row[group]) || 0, value: count }],
      };
    };

    return (
      <>
        <MetricVizControls
          filters={[<DemographicFilterSelect metric={metric} />]}
          metric={metric}
          smallData
        />
        <BarChartCluster
          demographicView={demographicView}
          data={clusters}
          accessors={visibleGroups}
          getTooltipProps={getClusterTooltipProps}
          flatLabels
          seriesColors={seriesColors}
          showLegend={false}
        />
        <SeriesToggles
          series={groups}
          colorsBySeries={seriesColors}
          counts={groupTotals}
          hidden={hiddenGroups}
          onToggle={toggleGroup}
          legend="Show or hide groups (number of releases shown):"
        />
        <ClusterNote>
          Each column is that group&apos;s share of all releases, so the columns
          for a stay length add up to its overall share. Hide large groups to
          zoom in on smaller ones; their values do not change.
        </ClusterNote>
        <VizNotes unknowns={unknowns} download={metric.download} />
      </>
    );
  }

  if (dataSeries) {
    return (
      <>
        <MetricVizControls
          filters={[<DemographicFilterSelect metric={metric} />]}
          metric={metric}
          smallData
        />
        <AutoHeightTransition initialHeight={singleChartHeight}>
          <ChartsWrapper>
            {chartTransitions.map(({ item, key, props }) => (
              <animated.div key={key} style={props}>
                {
                  // for type safety we have to check this again
                  // but it should always be defined if we've gotten this far
                  item.dataSeries && (
                    <BarChartTrellis
                      data={item.dataSeries}
                      getTooltipProps={getTooltipProps}
                    />
                  )
                }
              </animated.div>
            ))}
          </ChartsWrapper>
        </AutoHeightTransition>
        <VizNotes unknowns={unknowns} download={metric.download} />
      </>
    );
  }

  return null;
};

export default withMetricHydrator(observer(VizPrisonStayLengths));
