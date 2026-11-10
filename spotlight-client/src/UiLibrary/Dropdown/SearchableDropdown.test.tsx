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

import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import SearchableDropdown, { filterOptions } from "./SearchableDropdown";

const options = [
  { id: "ALL", label: "All Facilities" },
  { id: "G1", label: "All major prisons", group: "Major prisons" },
  { id: "COL", label: "Columbia Correctional Institution", group: "Major prisons" },
  { id: "LOW", label: "Lowell Correctional Institution", group: "Major prisons" },
  { id: "G2", label: "All re-entry centers", group: "Re-entry centers" },
  { id: "BAK", label: "Baker Re-Entry Center", group: "Re-entry centers" },
  { id: "HID", label: "Hidden", group: "Re-entry centers", hidden: true },
];

const setup = (onChange = jest.fn()) => {
  render(
    <SearchableDropdown
      label="Facility"
      options={options}
      onChange={onChange}
      selectedId="ALL"
    />
  );
  return onChange;
};

const openMenu = () =>
  fireEvent.click(screen.getByRole("button", { name: "Facility All Facilities" }));

test("shows the selection on the button and group headings in the menu", () => {
  setup();
  openMenu();
  const menu = screen.getByRole("listbox");
  expect(within(menu).getByText("Major prisons")).toBeVisible();
  expect(within(menu).getByText("Re-entry centers")).toBeVisible();
  expect(within(menu).getAllByRole("option")).toHaveLength(6);
  expect(within(menu).queryByText("Hidden")).toBeNull();
});

test("typing filters options by label or group, and Enter selects", () => {
  const onChange = setup();
  openMenu();
  const input = screen.getByPlaceholderText("Search facilities");
  expect(input).toHaveFocus();

  fireEvent.change(input, { target: { value: "lowell" } });
  const menu = screen.getByRole("listbox");
  expect(within(menu).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Lowell Correctional Institution",
  ]);
  expect(screen.getByText("1 of 6 shown")).toBeVisible();

  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith("LOW");
});

test("clicking an option selects it", () => {
  const onChange = setup();
  openMenu();
  fireEvent.click(screen.getByRole("option", { name: "All re-entry centers" }));
  expect(onChange).toHaveBeenCalledWith("G2");
});

test("says so when nothing matches", () => {
  setup();
  openMenu();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzz" } });
  expect(screen.getByText("No matches")).toBeVisible();
  expect(screen.queryAllByRole("option")).toHaveLength(0);
});

test("filterOptions matches every search word against label and group", () => {
  expect(filterOptions(options, "re-entry baker").map((o) => o.id)).toEqual(["BAK"]);
  expect(filterOptions(options, "major").map((o) => o.id)).toEqual(["G1", "COL", "LOW"]);
  expect(filterOptions(options, "  ").length).toBe(6);
});
