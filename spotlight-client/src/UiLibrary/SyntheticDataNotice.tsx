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

import { palette } from "@recidiviz/design-system";
import { rem } from "polished";
import React from "react";
import styled from "styled-components/macro";
import { SectionDataSource } from "../contentApi/types";

const Notice = styled.aside`
  border-left: ${rem(4)} solid #d9a95f;
  background: #fbf3e6;
  color: ${palette.slate85};
  font-size: ${rem(14)};
  line-height: 1.45;
  margin: ${rem(16)} 0;
  padding: ${rem(10)} ${rem(14)};
`;

const Label = styled.strong`
  color: #7a5418;
  display: block;
  font-size: ${rem(12)};
  letter-spacing: 0.06em;
  margin-bottom: ${rem(2)};
  text-transform: uppercase;
`;

/**
 * Marks a section whose chart is built from generated (synthetic) data rather
 * than records published by the agency, so it can never be mistaken for real data.
 */
const SyntheticDataNotice: React.FC<{ dataSource?: SectionDataSource }> = ({
  dataSource,
}) => {
  if (dataSource !== "synthetic") return null;
  return (
    <Notice aria-label="Illustrative data notice">
      <Label>Illustrative data</Label>
      The agency does not publish this data. The numbers in this chart are
      synthetic, generated to show what the chart would look like, and do not
      describe real people.
    </Notice>
  );
};

export default SyntheticDataNotice;
