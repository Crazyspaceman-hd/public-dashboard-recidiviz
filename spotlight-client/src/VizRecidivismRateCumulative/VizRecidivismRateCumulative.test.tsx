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

import { screen } from "@testing-library/react";
import { runInAction, when } from "mobx";
import React from "react";
import RecidivismRateMetric from "../contentModels/RecidivismRateMetric";
import DataStore from "../DataStore";
import { reactImmediately, renderWithStore } from "../testUtils";
import VizRecidivismRateCumulative from "./VizRecidivismRateCumulative";

jest.mock("../MeasureWidth/MeasureWidth");

let metric: RecidivismRateMetric;

beforeEach(() => {
  runInAction(() => {
    DataStore.tenantStore.currentTenantId = "US_ND";
  });
  reactImmediately(() => {
    const metricToTest = DataStore.tenant?.metrics.get(
      "PrisonRecidivismRateHistorical",
    );
    // it will be
    if (metricToTest instanceof RecidivismRateMetric) {
      metric = metricToTest;
    }
  });
});

afterEach(() => {
  runInAction(() => {
    DataStore.tenantStore.currentTenantId = undefined;
  });
});

test("loading", () => {
  renderWithStore(<VizRecidivismRateCumulative metric={metric} />);
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});

test("one combined curve with values written on the chart", async () => {
  renderWithStore(<VizRecidivismRateCumulative metric={metric} />);
  await when(() => !metric.isLoading);

  const chart = await screen.findByRole("img", {
    name: /^Share of people back in prison after release: \d+% within 1 year, \d+% within 3 years, \d+% within 5 years, \d+% within 10 years\.$/,
  });
  expect(chart).toBeInTheDocument();

  // labels are on the chart itself, not only in tooltips
  const curve = metric.pooledCurve ?? [];
  [1, 3, 5, 10].forEach((years) => {
    const point = curve.find((p) => p.followupYears === years);
    expect(point).toBeDefined();
  });
  expect(chart.querySelectorAll("text.value-label").length).toBe(4);

  expect(screen.getByText(/All release years combined/)).toBeInTheDocument();
  expect(
    screen.getByText("Range of individual release years"),
  ).toBeInTheDocument();
});

test("no release-year picker or demographic breakdown", async () => {
  renderWithStore(<VizRecidivismRateCumulative metric={metric} />);
  await when(() => !metric.isLoading);
  await screen.findByRole("img", { name: /^Share of people back in prison/ });

  expect(screen.queryByRole("button", { name: /cohort/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /^View /i })).toBeNull();
});

test("the y-axis fits the data instead of always running to 100%", async () => {
  renderWithStore(<VizRecidivismRateCumulative metric={metric} />);
  await when(() => !metric.isLoading);
  const chart = await screen.findByRole("img", {
    name: /^Share of people back in prison/,
  });

  const maxValue = Math.max(...(metric.pooledCurve ?? []).map((p) => p.max));
  const ticks = Array.from(chart.querySelectorAll(".grid text")).map((t) =>
    parseFloat(t.textContent ?? ""),
  );
  const top = Math.max(...ticks) / 100;
  expect(top).toBeGreaterThanOrEqual(maxValue);
  // headroom is at most one "nice" step above the data, not a fixed 100%
  expect(top).toBeLessThan(maxValue + 0.25);
});

test("supervision charts label the axis by type of return", async () => {
  let paroleMetric: RecidivismRateMetric | undefined;
  reactImmediately(() => {
    const m = DataStore.tenant?.metrics.get("ParoleRecidivismRateHistorical");
    if (m instanceof RecidivismRateMetric) paroleMetric = m;
  });
  if (!paroleMetric) throw new Error("parole recidivism metric missing");

  renderWithStore(<VizRecidivismRateCumulative metric={paroleMetric} />);
  await when(() => !paroleMetric?.isLoading);

  // default filter is "Any return", which includes returns to supervision
  expect(
    await screen.findByRole("img", {
      name: /^Share of people who returned after release:/,
    }),
  ).toBeInTheDocument();
});
