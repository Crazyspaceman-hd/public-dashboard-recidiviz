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

import {
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { runInAction, when } from "mobx";
import React from "react";
import DemographicsByCategoryMetric from "../contentModels/DemographicsByCategoryMetric";
import DataStore from "../DataStore";
import { reactImmediately, renderWithStore } from "../testUtils";
import { colors } from "../UiLibrary";
import VizPrisonStayLengths, {
  toShareOfAllReleases,
} from "./VizPrisonStayLengths";

jest.mock("../MeasureWidth/MeasureWidth");

let metric: DemographicsByCategoryMetric;

beforeEach(() => {
  runInAction(() => {
    DataStore.tenantStore.currentTenantId = "US_ND";
  });
  reactImmediately(() => {
    const metricToTest = DataStore.tenant?.metrics.get(
      "PrisonStayLengthAggregate",
    );
    // it will be
    if (metricToTest instanceof DemographicsByCategoryMetric) {
      metric = metricToTest;
    }
  });
});

afterEach(() => {
  runInAction(() => {
    // reset data store
    metric.demographicView = "total";
    DataStore.tenantStore.currentTenantId = undefined;
  });
});

test("loading", () => {
  renderWithStore(<VizPrisonStayLengths metric={metric} />);
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});

test("total chart", async () => {
  renderWithStore(<VizPrisonStayLengths metric={metric} />);

  await when(() => !metric.isLoading);

  const chart = screen.getByRole("group", { name: "7 bars in a bar chart" });
  expect(chart).toBeInTheDocument();
  expect(
    within(chart).getByRole("img", { name: "<1 year bar value 15%" }),
  ).toBeInTheDocument();
  expect(
    within(chart).getByRole("img", { name: "1–2 bar value 1%" }),
  ).toBeInTheDocument();
  expect(
    within(chart).getByRole("img", { name: "2–3 bar value 17%" }),
  ).toBeInTheDocument();
  expect(
    within(chart).getByRole("img", { name: "3–5 bar value 31%" }),
  ).toBeInTheDocument();
  expect(
    within(chart).getByRole("img", { name: "5–10 bar value 26%" }),
  ).toBeInTheDocument();
  expect(
    within(chart).getByRole("img", { name: "10–20 bar value 1%" }),
  ).toBeInTheDocument();
  expect(
    within(chart).getByRole("img", { name: "20+ bar value 9%" }),
  ).toBeInTheDocument();
});

test("demographic views are one grouped chart, with a column per group", async () => {
  renderWithStore(<VizPrisonStayLengths metric={metric} />);

  await when(() => !metric.isLoading);

  expect(
    screen.getByRole("group", { name: "7 bars in a bar chart" }),
  ).toBeInTheDocument();

  const menuButton = screen.getByRole("button", {
    name: "View Total",
  });

  const expectGroupedChart = async (view: string): Promise<void> => {
    // the grouped chart keeps one figure and cross-fades its contents,
    // so wait for the figure to be labeled with the new view
    await screen.findByRole("figure", { name: view });
    // no small multiples: the per-group trellis charts are gone
    expect(
      screen.queryAllByRole("group", { name: "7 bars in a bar chart" }),
    ).toHaveLength(0);
    // every group in this view has a checked show/hide toggle
    const groups = metric.dataSeries?.map(({ label }) => label) ?? [];
    expect(groups.length).toBeGreaterThan(1);
    groups.forEach((group) =>
      expect(
        screen.getByRole("checkbox", { name: new RegExp(`^${group}`) }),
      ).toBeChecked(),
    );
  };

  fireEvent.click(menuButton);
  fireEvent.click(screen.getByRole("option", { name: "Race or Ethnicity" }));
  await expectGroupedChart("raceOrEthnicity");
  expect(
    screen.getByText(/share of all releases/),
  ).toBeInTheDocument();

  fireEvent.click(menuButton);
  fireEvent.click(screen.getByRole("option", { name: "Gender" }));
  await expectGroupedChart("gender");

  fireEvent.click(menuButton);
  fireEvent.click(screen.getByRole("option", { name: "Age Group" }));
  await expectGroupedChart("ageBucket");
});

test("all bars are the same color", async () => {
  renderWithStore(<VizPrisonStayLengths metric={metric} />);

  await when(() => !metric.isLoading);

  const chart = screen.getByRole("group", { name: "7 bars in a bar chart" });

  within(chart)
    .getAllByRole("img")
    .forEach((el) =>
      expect(el).toHaveStyle(`fill: ${colors.dataVizNamed.teal}`),
    );

  expect.hasAssertions();
});

test("grouped columns are shares of all releases, not of each group", () => {
  const record = (label: string, value: number) => ({
    label,
    value,
    pct: 0,
    color: "",
  });
  // a big group and a small group with the same within-group pattern
  const rows = toShareOfAllReleases([
    { label: "Big", records: [record("<1 year", 900), record("1–2", 100)] },
    { label: "Small", records: [record("<1 year", 9), record("1–2", 1)] },
  ]);
  const underOneYear = rows.find(({ label }) => label === "<1 year");
  // 900 of 1,010 releases vs 9 of 1,010: not 90% each
  expect(underOneYear?.Big).toBeCloseTo(900 / 1010);
  expect(underOneYear?.Small).toBeCloseTo(9 / 1010);
  // every column across every stay length adds up to all releases
  const total = rows.reduce(
    (acc, row) => acc + Number(row.Big) + Number(row.Small),
    0,
  );
  expect(total).toBeCloseTo(1);
});

test("group toggles hide columns and keep at least one group", async () => {
  renderWithStore(<VizPrisonStayLengths metric={metric} />);
  await when(() => !metric.isLoading);

  fireEvent.click(screen.getByRole("button", { name: "View Total" }));
  fireEvent.click(screen.getByRole("option", { name: "Gender" }));
  await screen.findByRole("figure", { name: "gender" });

  const [first, second] = metric.dataSeries?.map(({ label }) => label) ?? [];
  const firstBox = screen.getByRole("checkbox", { name: new RegExp(`^${first}`) });
  const secondBox = screen.getByRole("checkbox", {
    name: new RegExp(`^${second}`),
  });

  fireEvent.click(firstBox);
  expect(firstBox).not.toBeChecked();
  // the only group still shown cannot be hidden
  expect(secondBox).toBeChecked();
  expect(secondBox).toBeDisabled();

  fireEvent.click(firstBox);
  expect(firstBox).toBeChecked();
  expect(secondBox).toBeEnabled();
});
