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

import { fireEvent, screen } from "@testing-library/react";
import { runInAction, when } from "mobx";
import React from "react";
import RecidivismRateMetric from "../contentModels/RecidivismRateMetric";
import DataStore from "../DataStore";
import { reactImmediately, renderWithStore } from "../testUtils";
import VizRecidivismRateSingleFollowup, {
  SMALL_GROUP_RELEASES,
  toRateClusters,
} from "./VizRecidivismRateSingleFollowup";

jest.mock("../MeasureWidth/MeasureWidth");

let metric: RecidivismRateMetric;

let originalFilters: {
  demographicView: RecidivismRateMetric["demographicView"];
  followupYears: RecidivismRateMetric["followUpYears"];
};

beforeEach(() => {
  runInAction(() => {
    DataStore.tenantStore.currentTenantId = "US_ND";
  });
  reactImmediately(() => {
    const metricToTest = DataStore.tenant?.metrics.get(
      "PrisonRecidivismRateSingleFollowupHistorical",
    );
    // it will be
    if (metricToTest instanceof RecidivismRateMetric) {
      metric = metricToTest;
      originalFilters = {
        demographicView: metric.demographicView,
        followupYears: metric.followUpYears,
      };
    }
  });
});

afterEach(() => {
  runInAction(() => {
    DataStore.tenantStore.currentTenantId = undefined;
    metric.demographicView = originalFilters.demographicView;
    metric.followUpYears = originalFilters.followupYears;
  });
});

test("loading", () => {
  renderWithStore(<VizRecidivismRateSingleFollowup metric={metric} />);
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});

test("total view: one grouped chart of each release year's rate", async () => {
  renderWithStore(<VizRecidivismRateSingleFollowup metric={metric} />);
  await when(() => !metric.isLoading);

  expect(
    await screen.findByRole("figure", { name: "total" }),
  ).toBeInTheDocument();
  // a single series needs no show/hide toggles
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

  const clusters = toRateClusters(metric.singleFollowupDemographics ?? []);
  expect(clusters.map(({ label }) => label)).toEqual([
    "2009",
    "2010",
    "2011",
    "2012",
    "2013",
    "2014",
    "2015",
    "2016",
  ]);
  const expected = [0.41, 0.49, 0.31, 0.49, 0.44, 0.4, 0.3, 0.38];
  clusters.forEach((row, i) =>
    expect(Number(row.Total)).toBeCloseTo(expected[i], 2),
  );
});

test("demographic views are grouped columns with toggles", async () => {
  renderWithStore(<VizRecidivismRateSingleFollowup metric={metric} />);
  await when(() => !metric.isLoading);

  const menuButton = screen.getByRole("button", { name: "View Total" });
  const check = async (option: string, view: string) => {
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole("option", { name: option }));
    await screen.findByRole("figure", { name: view });
    const series = metric.singleFollowupDemographics ?? [];
    expect(series.length).toBeGreaterThan(1);
    series.forEach(({ label, records }) => {
      const releases = (records as { denominator: number }[]).reduce(
        (sum, r) => sum + r.denominator,
        0,
      );
      const box = screen.getByRole("checkbox", {
        name: new RegExp(`^${label}`),
      });
      const allSmall = series.every(({ records: rs }) =>
        (rs as { denominator: number }[]).reduce(
          (sum, r) => sum + r.denominator,
          0,
        ) < SMALL_GROUP_RELEASES,
      );
      // very small groups start hidden, unless every group is small
      if (releases < SMALL_GROUP_RELEASES && !allSmall) {
        expect(box).not.toBeChecked();
      } else {
        expect(box).toBeChecked();
      }
    });
  };

  await check("Race or Ethnicity", "raceOrEthnicity");
  await check("Gender", "gender");
  await check("Age Group", "ageBucket");
});

test("rates are each group's own rate, not a share of all releases", () => {
  const rows = toRateClusters([
    {
      label: "Big",
      records: [
        { label: "2020", value: 300, pct: 0.3, color: "", denominator: 1000 },
      ],
    },
    {
      label: "Small",
      records: [
        { label: "2020", value: 3, pct: 0.3, color: "", denominator: 10 },
      ],
    },
  ]);
  expect(rows).toEqual([{ label: "2020", Big: 0.3, Small: 0.3 }]);
});

test("followup period filter", async () => {
  renderWithStore(<VizRecidivismRateSingleFollowup metric={metric} />);
  await when(() => !metric.isLoading);

  const menuButton = screen.getByRole("button", {
    name: "Follow-up Period 3 Years",
  });
  fireEvent.click(menuButton);
  fireEvent.click(screen.getByRole("option", { name: "1 Year" }));
  expect(menuButton).toHaveTextContent("1 Year");
  expect(await screen.findByText(/returned within 1 year\./)).toBeInTheDocument();
  expect(toRateClusters(metric.singleFollowupDemographics ?? [])).toHaveLength(10);

  fireEvent.click(menuButton);
  fireEvent.click(screen.getByRole("option", { name: "5 Years" }));
  expect(menuButton).toHaveTextContent("5 Years");
  expect(await screen.findByText(/returned within 5 years\./)).toBeInTheDocument();
  expect(toRateClusters(metric.singleFollowupDemographics ?? [])).toHaveLength(6);
});
