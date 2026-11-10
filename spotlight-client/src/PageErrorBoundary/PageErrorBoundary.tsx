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

import { Location } from "@reach/router";
import React from "react";
import ErrorMessage from "../ErrorMessage";

type BoundaryProps = { resetKey: string };
type BoundaryState = { error: Error | null };

/**
 * Catches render errors and clears them when `resetKey` changes. Written here rather
 * than using react-error-boundary's resetKeys, which (in the installed version) skips
 * the first change after an error thrown on initial render, so a page that failed to
 * load would need two navigations to recover.
 */
class ResettingBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: BoundaryProps): void {
    const { resetKey } = this.props;
    const { error } = this.state;
    if (error !== null && prevProps.resetKey !== resetKey) this.reset();
  }

  reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    const { children } = this.props;
    const { error } = this.state;
    if (error !== null) {
      return <ErrorMessage error={error} resetErrorBoundary={this.reset} />;
    }
    return children;
  }
}

/**
 * Contains errors to the page content, so navigation and the footer keep working,
 * and clears the error when the user goes to another page.
 */
const PageErrorBoundary: React.FC = ({ children }) => (
  <Location>
    {({ location }) => (
      <ResettingBoundary resetKey={location.pathname}>{children}</ResettingBoundary>
    )}
  </Location>
);

export default PageErrorBoundary;
