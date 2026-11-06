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

import { useEffect } from "react";
import { NAV_BAR_HEIGHT } from "../constants";
import { breakpoints } from "../UiLibrary";
import { getSnapTarget } from "./getSnapTarget";

/** How long scrolling must pause (ms) before the page settles on a section. */
const SETTLE_DELAY = 140;

/**
 * After the user stops scrolling, glides the page to the next (or previous)
 * narrative section in the direction they were scrolling. Scrolling itself is
 * never intercepted, so wheel, trackpad, keyboard and scrollbar all behave normally.
 * Desktop only, and off for visitors who prefer reduced motion.
 * See getSnapTarget for the rules.
 */
export function useSectionSnap({
  containerRef,
  enabled,
}: {
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  enabled: boolean;
}): void {
  useEffect(() => {
    if (!enabled || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(
      `(min-width: ${breakpoints.desktop[0]}px) and (prefers-reduced-motion: no-preference)`
    );

    let timer: number | undefined;
    let settledAt = window.scrollY;
    let snapping = false;

    const settle = () => {
      const position = window.scrollY;
      // this pause is the end of our own glide; just record where we landed
      if (snapping || !media.matches || !containerRef.current) {
        snapping = false;
        settledAt = position;
        return;
      }
      const sectionStarts = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(
          ":scope > [id^=section]"
        )
      ).map((el) => el.getBoundingClientRect().top + position - NAV_BAR_HEIGHT);

      const target = getSnapTarget({
        sectionStarts,
        position,
        previousPosition: settledAt,
        viewportHeight: window.innerHeight - NAV_BAR_HEIGHT,
        maxPosition: document.documentElement.scrollHeight - window.innerHeight,
      });

      if (target === null || Math.abs(target - position) < 1) {
        settledAt = position;
        return;
      }
      snapping = true;
      settledAt = target;
      window.scrollTo({ top: target, behavior: "smooth" });
    };

    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, SETTLE_DELAY);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [containerRef, enabled]);
}
