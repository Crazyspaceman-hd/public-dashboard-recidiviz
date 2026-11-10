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

import {
  createHistory,
  createMemorySource,
  LocationProvider,
} from "@reach/router";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import PageErrorBoundary from "./PageErrorBoundary";

let shouldThrow = true;
const Page = () => {
  if (shouldThrow) throw new Error("test page error");
  return <p>page content</p>;
};

const renderWithHistory = () => {
  const history = createHistory(createMemorySource("/page-one"));
  render(
    <LocationProvider history={history}>
      <nav>site navigation</nav>
      <PageErrorBoundary>
        <Page />
      </PageErrorBoundary>
    </LocationProvider>,
  );
  return history;
};

beforeEach(() => {
  shouldThrow = true;
  // React logs caught render errors; keep test output readable
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("contains a page error and keeps the rest of the site", () => {
  renderWithHistory();
  expect(screen.getByText("An error has occurred.")).toBeVisible();
  expect(screen.getByText("test page error")).toBeVisible();
  expect(screen.getByText("site navigation")).toBeVisible();
});

test("clears the error when the user navigates", async () => {
  const history = renderWithHistory();
  shouldThrow = false;
  await act(async () => {
    await history.navigate("/page-two");
  });
  expect(screen.getByText("page content")).toBeVisible();
  expect(screen.queryByText("An error has occurred.")).not.toBeInTheDocument();
});

test("can be retried", () => {
  renderWithHistory();
  shouldThrow = false;
  userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("page content")).toBeVisible();
});
