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

import { rem } from "polished";
import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components/macro";
import { Checkbox, colors } from "../UiLibrary";
import { formatAsNumber } from "../utils";

const Fieldset = styled.fieldset`
  border: none;
  display: flex;
  flex-wrap: wrap;
  font-size: ${rem(13)};
  gap: ${rem(6)} ${rem(18)};
  margin: ${rem(12)} 0 0;
  padding: 0;
`;

const Legend = styled.legend`
  color: ${colors.caption};
  margin-bottom: ${rem(6)};
  padding: 0;
`;

const ToggleLabel = styled.label<{ disabled?: boolean }>`
  align-items: center;
  color: ${colors.text};
  cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
  display: inline-flex;
`;

const Swatch = styled.span<{ color: string; off: boolean }>`
  background: ${(props) => (props.off ? "transparent" : props.color)};
  border: 2px solid ${(props) => props.color};
  border-radius: 50%;
  display: inline-block;
  height: ${rem(10)};
  margin-right: ${rem(6)};
  width: ${rem(10)};
`;

const Count = styled.span`
  color: ${colors.caption};
  margin-left: ${rem(4)};
`;

/** A stable color for each series, by its position in the full list. */
export function seriesColorMap(series: string[]): Record<string, string> {
  return Object.fromEntries(
    series.map((s, i) => [s, colors.dataViz[i % colors.dataViz.length]])
  );
}

/**
 * Tracks which series the reader has hidden. Whenever `resetKey` changes (e.g.
 * switching between race, sex and age views) the hidden list goes back to
 * `defaultHidden` (e.g. groups too small to chart reliably).
 */
export function useHiddenSeries(
  resetKey: unknown,
  defaultHidden: string[] = []
): [string[], (series: string) => void] {
  const defaultsRef = useRef(defaultHidden);
  defaultsRef.current = defaultHidden;
  const [hidden, setHidden] = useState<string[]>(defaultHidden);
  // the default list can arrive after data loads, so compare by content
  const defaultsKey = defaultHidden.join("|");
  useEffect(() => setHidden(defaultsRef.current), [resetKey, defaultsKey]);
  const toggle = (series: string) =>
    setHidden((current) =>
      current.includes(series)
        ? current.filter((s) => s !== series)
        : [...current, series]
    );
  return [hidden, toggle];
}

/**
 * Checkboxes that double as a color legend: one per series, with its size
 * (e.g. number of releases) so readers can tell large groups from small ones.
 * The last visible series cannot be hidden.
 */
const SeriesToggles: React.FC<{
  series: string[];
  colorsBySeries: Record<string, string>;
  counts?: Record<string, number>;
  hidden: string[];
  onToggle: (series: string) => void;
  legend: string;
}> = ({ series, colorsBySeries, counts, hidden, onToggle, legend }) => {
  const visibleCount = series.filter((s) => !hidden.includes(s)).length;
  return (
    <Fieldset>
      <Legend>{legend}</Legend>
      {series.map((name) => {
        const off = hidden.includes(name);
        const lastOne = !off && visibleCount === 1;
        return (
          <ToggleLabel key={name} disabled={lastOne}>
            <Checkbox
              checked={!off}
              disabled={lastOne}
              onChange={() => onToggle(name)}
            />
            <Swatch color={colorsBySeries[name]} off={off} aria-hidden />
            {name}
            {counts && <Count>{formatAsNumber(counts[name] ?? 0)}</Count>}
          </ToggleLabel>
        );
      })}
    </Fieldset>
  );
};

export default SeriesToggles;
