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

import { ascending, sum } from "d3-array";
import { observer } from "mobx-react-lite";
import { rem } from "polished";
import React from "react";
import styled from "styled-components/macro";
import { TooltipContentFunction } from "../charts";
import {
  BarChartCluster,
  BarChartClusterRecord,
} from "../charts/BarChartCluster";
import SeriesToggles, {
  seriesColorMap,
  useHiddenSeries,
} from "../charts/SeriesToggles";
import RecidivismRateMetric from "../contentModels/RecidivismRateMetric";
import { DemographicCategoryRateRecords } from "../contentModels/types";
import DemographicFilterSelect from "../DemographicFilterSelect";
import MetricVizControls from "../MetricVizControls";
import ReturnTypeFilterSelect from "../ReturnTypeFilterSelect";
import { colors } from "../UiLibrary";
import { formatAsNumber, formatAsPct } from "../utils";
import VizNotes from "../VizNotes";
import withMetricHydrator from "../withMetricHydrator";
import FollowupPeriodFilterSelect from "./FollowupPeriodFilterSelect";

/** groups with fewer releases than this start hidden: their rates are too noisy */
export const SMALL_GROUP_RELEASES = 100;

const ClusterNote = styled.p`
  color: ${colors.caption};
  font-size: ${rem(13)};
  margin-top: ${rem(8)};
`;

/**
 * One cluster per release year, one column per group; each value is that group's
 * own return rate (rates, unlike shares, are comparable across group sizes).
 */
export function toRateClusters(
  series: DemographicCategoryRateRecords[]
): BarChartClusterRecord[] {
  const cohorts = Array.from(
    new Set(series.flatMap(({ records }) => records.map(({ label }) => label)))
  ).sort((a, b) => ascending(Number(a), Number(b)));
  return cohorts.map((cohort) => {
    const row: BarChartClusterRecord = { label: cohort };
    series.forEach(({ label, records }) => {
      row[label] = records.find((r) => r.label === cohort)?.pct ?? 0;
    });
    return row;
  });
}

type VizRecidivismRateSingleFollowupProps = {
  metric: RecidivismRateMetric;
};

const VizRecidivismRateSingleFollowup: React.FC<VizRecidivismRateSingleFollowupProps> = ({
  metric,
}) => {
  const {
    demographicView,
    followUpYears,
    includesDemographics,
    singleFollowupDemographics,
    unknowns,
  } = metric;

  const releasesByGroup: Record<string, number> = Object.fromEntries(
    (singleFollowupDemographics ?? []).map(({ label, records }) => [
      label,
      sum(records as { denominator: number }[], (r) => r.denominator),
    ])
  );
  const allGroups = Object.keys(releasesByGroup);
  const belowThreshold = allGroups.filter(
    (g) => releasesByGroup[g] < SMALL_GROUP_RELEASES
  );
  // never start with every group hidden (e.g. a small state where all are small)
  const smallGroups =
    allGroups.length > 1 && belowThreshold.length < allGroups.length
      ? belowThreshold
      : [];
  const [hiddenGroups, toggleGroup] = useHiddenSeries(
    demographicView,
    smallGroups
  );

  if (demographicView === "nofilter")
    throw new Error(
      "Unable to display this metric without demographic filter."
    );

  if (!singleFollowupDemographics) return null;

  const groups = singleFollowupDemographics.map(({ label }) => label);
  const visibleGroups = groups.filter((g) => !hiddenGroups.includes(g));
  const seriesColors = seriesColorMap(groups);
  const years = followUpYears ?? 1;
  const withinYears = `within ${years} year${years === 1 ? "" : "s"}`;

  const getTooltipProps: TooltipContentFunction = (columnData) => {
    const group = String(columnData.rName);
    const cohort = String((columnData.data as BarChartClusterRecord).label);
    // the records type is an intersection, so name the fields we use explicitly
    const groupRecords = singleFollowupDemographics.find(
      ({ label }) => label === group
    )?.records as
      | { label: string; pct: number; value: number; denominator: number }[]
      | undefined;
    const record = groupRecords?.find(({ label }) => label === cohort);
    const rate = record?.pct ?? 0;
    const released = record?.denominator ?? 0;
    const returned = record?.value;
    return {
      title: `${groups.length > 1 ? `${group}, ` : ""}released ${cohort}`,
      records: [
        {
          value:
            returned === undefined || Number.isNaN(returned)
              ? `${formatAsPct(rate)} of ${formatAsNumber(released)}`
              : `${formatAsPct(rate)}: ${formatAsNumber(
                  returned
                )} of ${formatAsNumber(released)}`,
        },
      ],
    };
  };

  return (
    <>
      <MetricVizControls
        filters={[
          <FollowupPeriodFilterSelect metric={metric} />,
          metric.returnType !== undefined && (
            <ReturnTypeFilterSelect metric={metric} />
          ),
          includesDemographics && <DemographicFilterSelect metric={metric} />,
        ]}
        metric={metric}
        smallData
      />
      <BarChartCluster
        demographicView={demographicView}
        data={toRateClusters(singleFollowupDemographics)}
        accessors={visibleGroups}
        getTooltipProps={getTooltipProps}
        flatLabels
        seriesColors={seriesColors}
        showLegend={false}
      />
      {groups.length > 1 && (
        <SeriesToggles
          series={groups}
          colorsBySeries={seriesColors}
          counts={releasesByGroup}
          hidden={hiddenGroups}
          onToggle={toggleGroup}
          legend="Show or hide groups (number of releases shown):"
        />
      )}
      <ClusterNote>
        Each column is the share of that release year&apos;s releases who
        returned {withinYears}.
        {groups.length > 1 &&
          ` Rates for groups with few releases swing a lot from year to year; groups with fewer than ${SMALL_GROUP_RELEASES} releases start hidden.`}
      </ClusterNote>
      <VizNotes unknowns={unknowns} download={metric.download} />
    </>
  );
};

export default withMetricHydrator(observer(VizRecidivismRateSingleFollowup));
