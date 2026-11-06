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
import React, { useEffect, useState } from "react";
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
import DemographicsByCategoryMetric from "../contentModels/DemographicsByCategoryMetric";
import { DemographicCategoryRecords } from "../contentModels/types";
import DemographicFilterSelect from "../DemographicFilterSelect";
import MetricVizControls from "../MetricVizControls";
import { prisonStayLengthFields } from "../metricsApi";
import {
  animation,
  AutoHeightTransition,
  Checkbox,
  colors,
} from "../UiLibrary";
import { formatAsNumber } from "../utils";
import withMetricHydrator from "../withMetricHydrator";
import VizNotes from "../VizNotes";

const ChartsWrapper = styled.div`
  position: relative;
`;

const GroupToggles = styled.fieldset`
  border: none;
  display: flex;
  flex-wrap: wrap;
  font-size: ${rem(13)};
  gap: ${rem(6)} ${rem(18)};
  margin: ${rem(12)} 0 0;
  padding: 0;
`;

const ToggleLegend = styled.legend`
  color: ${colors.caption};
  margin-bottom: ${rem(6)};
  padding: 0;
`;

const ToggleLabel = styled.label<{ disabled?: boolean }>`
  align-items: center;
  color: ${colors.text};
  cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
  display: inline-flex;
`;

const Swatch = styled.span<{ color: string; off: boolean }>`
  background: ${(props) => (props.off ? "transparent" : props.color)};
  border: 2px solid ${(props) => props.color};
  border-radius: 50%;
  display: inline-block;
  height: ${rem(10)};
  margin-right: ${rem(6)};
  width: ${rem(10)};
`;

const GroupCount = styled.span`
  color: ${colors.caption};
  margin-left: ${rem(4)};
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
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([]);
  useEffect(() => setHiddenGroups([]), [demographicView]);

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
    const seriesColors = Object.fromEntries(
      groups.map((g, i) => [g, colors.dataViz[i % colors.dataViz.length]])
    );
    const groupTotals = Object.fromEntries(
      dataSeries.map(({ label, records }) => [
        label,
        sum(records, ({ value }) => value),
      ])
    );
    const toggleGroup = (group: string) =>
      setHiddenGroups((hidden) =>
        hidden.includes(group)
          ? hidden.filter((g) => g !== group)
          : [...hidden, group]
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
        <GroupToggles>
          <ToggleLegend>
            Show or hide groups (number of releases shown):
          </ToggleLegend>
          {groups.map((group) => {
            const off = hiddenGroups.includes(group);
            const lastOne = !off && visibleGroups.length === 1;
            return (
              <ToggleLabel key={group} disabled={lastOne}>
                <Checkbox
                  checked={!off}
                  disabled={lastOne}
                  onChange={() => toggleGroup(group)}
                />
                <Swatch color={seriesColors[group]} off={off} aria-hidden />
                {group}
                <GroupCount>{formatAsNumber(groupTotals[group])}</GroupCount>
              </ToggleLabel>
            );
          })}
        </GroupToggles>
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
