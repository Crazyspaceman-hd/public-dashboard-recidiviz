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

import { PatternLines } from "@vx/pattern";
import { rem } from "polished";
import React from "react";
import styled from "styled-components/macro";
import { STATISTIC_THRESHOLD } from "../constants";
import { colors } from "../UiLibrary";
import { isSmallData } from "./utils";

const Note = styled.p`
  align-items: center;
  color: ${colors.caption};
  display: flex;
  font-size: ${rem(13)};
  gap: ${rem(8)};
  margin: ${rem(8)} 0 0;
`;

/** True when any of these series would be drawn striped (fewer than 100 people). */
export function anySmallData(series: { records: { value: number }[] }[]): boolean {
  return series.some(({ records }) => isSmallData(records));
}

/**
 * Explains the diagonal stripes ProportionalBar and BubbleChart draw over groups
 * with fewer than STATISTIC_THRESHOLD people. Render it only when stripes are
 * actually on screen.
 */
const SmallDataNote: React.FC = () => (
  <Note>
    <svg width={20} height={12} aria-hidden>
      <defs>
        <PatternLines
          id="smallDataNoteSwatch"
          height={5}
          width={5}
          background={colors.dataViz[0]}
          stroke="white"
          strokeWidth={0.5}
          orientation={["diagonal"]}
        />
      </defs>
      <rect width={20} height={12} rx={2} fill="url(#smallDataNoteSwatch)" />
    </svg>
    <span>
      Striped bars are based on fewer than {STATISTIC_THRESHOLD} people, so a
      few people can change their percentages a lot.
    </span>
  </Note>
);

export default SmallDataNote;
