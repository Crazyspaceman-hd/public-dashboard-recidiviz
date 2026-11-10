// Recidiviz - a data platform for criminal justice reform
// Copyright (C) 2020 Recidiviz, Inc.
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
import React from "react";
import { FallbackProps } from "react-error-boundary";
import styled from "styled-components/macro";
import {
  colors,
  CopyBlock,
  PageSection,
  PageTitle,
  UnStyledButton,
} from "../UiLibrary";

const RetryButton = styled(UnStyledButton)`
  border: 1px solid ${colors.text};
  border-radius: ${rem(4)};
  margin-top: ${rem(24)};
  padding: ${rem(8)} ${rem(16)};
`;

const ErrorMessage: React.FC<FallbackProps> = ({
  error,
  resetErrorBoundary,
}) => {
  return (
    <PageSection>
      <PageTitle>An error has occurred.</PageTitle>
      <CopyBlock>{error?.message}</CopyBlock>
      {resetErrorBoundary && (
        <RetryButton onClick={resetErrorBoundary}>Try again</RetryButton>
      )}
    </PageSection>
  );
};

export default ErrorMessage;
