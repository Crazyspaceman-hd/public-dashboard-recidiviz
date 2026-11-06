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

/** Movements smaller than this (px) settle back to the section you were on. */
export const NUDGE_THRESHOLD = 48;

/**
 * Decides where the page should settle after the user stops scrolling.
 *
 * - Stopped exactly on a section start: stay.
 * - Stopped inside a section taller than the screen, with no other section
 *   visible: stay, so long sections can be read freely.
 * - Otherwise, between two section starts: go to the next start in the direction
 *   of travel; a movement smaller than NUDGE_THRESHOLD goes back instead.
 *
 * All positions are scroll offsets (px) of the top of the visible area below the
 * nav bar. Returns the offset to scroll to, or null to leave the page where it is.
 */
export function getSnapTarget({
  sectionStarts,
  position,
  previousPosition,
  viewportHeight,
  maxPosition,
  threshold = NUDGE_THRESHOLD,
}: {
  sectionStarts: number[];
  position: number;
  previousPosition: number;
  viewportHeight: number;
  maxPosition: number;
  threshold?: number;
}): number | null {
  if (!sectionStarts.length) return null;
  // within a pixel of the bottom: footer content, nothing further to snap to
  if (position >= maxPosition - 1) return null;

  // index of the section whose start is at or above the current position
  let current = -1;
  sectionStarts.forEach((start, i) => {
    if (start <= position + 1) current = i;
  });
  if (current === -1) return null; // above the first section
  const currentStart = sectionStarts[current];
  const nextStart = sectionStarts[current + 1];

  if (Math.abs(position - currentStart) <= 1) return null; // already aligned
  if (nextStart === undefined) return null; // in the last section: free scrolling

  // reading inside a tall section: the next section hasn't entered the view yet
  if (position + viewportHeight <= nextStart + 1) return null;

  const clamp = (target: number) => Math.min(target, maxPosition);
  const movingDown = position >= previousPosition;
  if (movingDown) {
    return position - currentStart < threshold
      ? clamp(currentStart)
      : clamp(nextStart);
  }
  return nextStart - position < threshold
    ? clamp(nextStart)
    : clamp(currentStart);
}
