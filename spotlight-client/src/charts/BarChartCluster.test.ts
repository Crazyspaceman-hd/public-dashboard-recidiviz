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

import { pctTickFormatter } from "./BarChartCluster";

test("whole percents at a normal scale", () => {
  const fmt = pctTickFormatter(0.21);
  expect([0, 0.05, 0.1, 0.2].map(fmt)).toEqual(["0%", "5%", "10%", "20%"]);
});

test("one decimal when zoomed to a few percent", () => {
  const fmt = pctTickFormatter(0.025);
  expect([0, 0.005, 0.01, 0.015].map(fmt)).toEqual(["0%", "0.5%", "1%", "1.5%"]);
});

test("enough decimals that tiny ranges never repeat a label", () => {
  const fmt = pctTickFormatter(0.0015);
  const labels = [0, 0.0005, 0.001, 0.0015].map(fmt);
  expect(labels).toEqual(["0%", "0.05%", "0.1%", "0.15%"]);
  expect(new Set(labels).size).toBe(labels.length);
});
