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

import { observer } from "mobx-react-lite";
import React from "react";
import RecidivismCurve from "../charts/RecidivismCurve";
import RecidivismRateMetric from "../contentModels/RecidivismRateMetric";
import MetricVizControls from "../MetricVizControls";
import ReturnTypeFilterSelect from "../ReturnTypeFilterSelect";
import VizNotes from "../VizNotes";
import withMetricHydrator from "../withMetricHydrator";

// the y-axis title follows the Type of Return filter where there is one
const VALUE_LABELS: Record<string, string> = {
  ALL: "Share of people who returned",
  INCARCERATION: "Share of people back in prison",
  SUPERVISION: "Share of people back on supervision",
};

type VizRecidivismRateCumulativeProps = {
  metric: RecidivismRateMetric;
};

/**
 * Cumulative recidivism shown as one combined curve over a band of individual
 * release years. Comparing release years is left to the single-follow-up chart,
 * so there is no release-year picker or demographic breakdown here.
 */
const VizRecidivismRateCumulative: React.FC<VizRecidivismRateCumulativeProps> = ({
  metric,
}) => {
  const { pooledCurve, unknowns } = metric;

  if (!pooledCurve) return null;

  return (
    <>
      <MetricVizControls
        filters={[
          metric.returnType !== undefined && (
            <ReturnTypeFilterSelect metric={metric} />
          ),
        ]}
        metric={metric}
        smallData
      />
      <RecidivismCurve
        data={pooledCurve}
        valueLabel={
          metric.returnType !== undefined
            ? VALUE_LABELS[metric.returnType]
            : undefined
        }
      />
      <VizNotes unknowns={unknowns} download={metric.download} />
    </>
  );
};

export default withMetricHydrator(observer(VizRecidivismRateCumulative));
