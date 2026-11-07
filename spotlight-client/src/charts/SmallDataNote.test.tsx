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

import { render, screen } from "@testing-library/react";
import React from "react";
import { STATISTIC_THRESHOLD } from "../constants";
import SmallDataNote, { anySmallData } from "./SmallDataNote";

const series = (...totals: number[]) =>
  totals.map((total) => ({ records: [{ value: total / 2 }, { value: total / 2 }] }));

test("detects when any series would be striped", () => {
  expect(anySmallData(series(STATISTIC_THRESHOLD, 5000))).toBe(false);
  expect(anySmallData(series(STATISTIC_THRESHOLD - 2, 5000))).toBe(true);
  expect(anySmallData([])).toBe(false);
});

test("explains the stripes and the threshold", () => {
  render(<SmallDataNote />);
  expect(
    screen.getByText(
      new RegExp(`Striped bars are based on fewer than ${STATISTIC_THRESHOLD} people`)
    )
  ).toBeInTheDocument();
});
