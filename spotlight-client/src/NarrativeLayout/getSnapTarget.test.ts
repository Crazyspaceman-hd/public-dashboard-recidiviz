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

import { getSnapTarget } from "./getSnapTarget";

// three screen-sized sections (720px visible area), then a tall one, then a footer
const base = {
  sectionStarts: [0, 720, 1440, 2160],
  viewportHeight: 720,
  maxPosition: 4000,
};

test("a short scroll down goes to the next section", () => {
  expect(getSnapTarget({ ...base, previousPosition: 0, position: 200 })).toBe(720);
});

test("a short scroll up goes to the previous section", () => {
  expect(getSnapTarget({ ...base, previousPosition: 720, position: 500 })).toBe(0);
});

test("a tiny nudge settles back where it started", () => {
  expect(getSnapTarget({ ...base, previousPosition: 720, position: 740 })).toBe(720);
  expect(getSnapTarget({ ...base, previousPosition: 720, position: 700 })).toBe(720);
});

test("stopping on a section start stays put", () => {
  expect(getSnapTarget({ ...base, previousPosition: 0, position: 720 })).toBeNull();
});

test("reading inside a tall section is left alone", () => {
  const tall = { ...base, sectionStarts: [0, 720, 2400] }; // section 2 is 1680px tall
  expect(getSnapTarget({ ...tall, previousPosition: 720, position: 1200 })).toBeNull();
  // once the next section comes into view, it snaps again
  expect(getSnapTarget({ ...tall, previousPosition: 1200, position: 1900 })).toBe(2400);
});

test("free scrolling in the last section and at the bottom of the page", () => {
  expect(getSnapTarget({ ...base, previousPosition: 2160, position: 2500 })).toBeNull();
  expect(getSnapTarget({ ...base, previousPosition: 3000, position: 4000 })).toBeNull();
});

test("targets are clamped to the scrollable range", () => {
  expect(
    getSnapTarget({ ...base, maxPosition: 1300, previousPosition: 720, position: 1000 })
  ).toBe(1300);
});
