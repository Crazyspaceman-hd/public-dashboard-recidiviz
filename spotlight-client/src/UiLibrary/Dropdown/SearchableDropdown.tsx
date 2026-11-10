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

import { typography } from "@recidiviz/design-system";
import { useCombobox } from "downshift";
import { rem } from "polished";
import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components/macro";
import breakpoints from "../breakpoints";
import colors from "../colors";
import zIndex from "../zIndex";
import { BUTTON_HEIGHT } from "./common";
import { DropdownOption } from "./types";

type Option = DropdownOption & { hidden?: boolean };

const Container = styled.div`
  position: relative;
  z-index: ${zIndex.menu};
`;

const HiddenLabel = styled.label`
  display: none;
`;

const ToggleButton = styled.button`
  ${typography.Sans14}
  align-items: center;
  background: ${colors.buttonBackground};
  border: 1px solid ${colors.rule};
  border-radius: ${rem(BUTTON_HEIGHT / 2)};
  color: ${colors.text};
  cursor: pointer;
  display: flex;
  height: ${rem(BUTTON_HEIGHT)};
  max-width: ${rem(320)};
  padding: 0 ${rem(16)};

  &:hover,
  &:focus {
    background: ${colors.buttonBackgroundHover};
    outline: none;
  }

  &:disabled {
    color: ${colors.textDisabled};
    cursor: not-allowed;
  }
`;

const ButtonText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Caret = styled.span`
  border-left: ${rem(4)} solid transparent;
  border-right: ${rem(4)} solid transparent;
  border-top: ${rem(4)} solid currentColor;
  flex: 0 0 auto;
  height: 0;
  margin-left: ${rem(16)};
  width: 0;
`;

const Panel = styled.div<{ open: boolean }>`
  background: ${colors.buttonBackground};
  border: 1px solid ${colors.rule};
  border-radius: ${rem(BUTTON_HEIGHT / 4)};
  box-shadow: 0 ${rem(8)} ${rem(24)} rgba(0, 65, 62, 0.12);
  display: ${(props) => (props.open ? "flex" : "none")};
  flex-direction: column;
  /* phones: a sheet pinned inside the viewport, so it can never open off-screen */
  left: ${rem(16)};
  max-height: 70vh;
  position: fixed;
  right: ${rem(16)};
  top: 15vh;

  /* opens rightward, over the chart, so it never covers the narrative text column */
  @media screen and (min-width: ${breakpoints.tablet[0]}px) {
    left: 0;
    max-height: min(60vh, ${rem(440)});
    position: absolute;
    right: auto;
    top: ${rem(BUTTON_HEIGHT + 4)};
    width: ${rem(340)};
  }
`;

const SearchInput = styled.input`
  ${typography.Sans14}
  border: none;
  border-bottom: 1px solid ${colors.rule};
  border-radius: ${rem(BUTTON_HEIGHT / 4)} ${rem(BUTTON_HEIGHT / 4)} 0 0;
  color: ${colors.text};
  padding: ${rem(12)} ${rem(16)};
  width: 100%;

  &:focus {
    outline: 2px solid ${colors.accent};
    outline-offset: -2px;
  }
`;

const OptionList = styled.ul`
  ${typography.Sans14}
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: ${rem(4)} 0;

  &:focus {
    outline: none;
  }
`;

const GroupHeading = styled.li`
  color: ${colors.caption};
  font-size: ${rem(11)};
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: ${rem(12)} ${rem(16)} ${rem(4)};
  text-transform: uppercase;
`;

const OptionRow = styled.li<{ highlighted: boolean; selected: boolean }>`
  background: ${(props) =>
    props.highlighted ? colors.buttonBackgroundHover : "transparent"};
  cursor: pointer;
  font-weight: ${(props) => (props.selected ? 600 : "normal")};
  padding: ${rem(7)} ${rem(16)};
`;

const NoResults = styled.li`
  color: ${colors.caption};
  padding: ${rem(12)} ${rem(16)};
`;

const Count = styled.div`
  border-top: 1px solid ${colors.rule};
  color: ${colors.caption};
  font-size: ${rem(12)};
  padding: ${rem(6)} ${rem(16)};
`;

export function filterOptions(options: Option[], query: string): Option[] {
  const visible = options.filter(({ hidden }) => !hidden);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return visible;
  return visible.filter((option) => {
    const haystack = `${option.label} ${option.group || ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * A dropdown for long lists: options can be organized under group headings,
 * and a search box filters them by label or group name as you type.
 * Keyboard: type to filter, arrow keys to move, Enter to choose, Escape to close.
 */
const SearchableDropdown: React.FC<{
  disabled?: boolean;
  label: string;
  onChange: (id: string) => void;
  options: Option[];
  selectedId?: string;
}> = ({ disabled, label, onChange, options, selectedId }) => {
  const [query, setQuery] = useState("");
  const items = useMemo(() => filterOptions(options, query), [options, query]);
  const selectedItem = options.find(({ id }) => id === selectedId) || null;
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    isOpen,
    getComboboxProps,
    getInputProps,
    getItemProps,
    getLabelProps,
    getMenuProps,
    getToggleButtonProps,
    highlightedIndex,
  } = useCombobox<Option>({
    items,
    itemToString: (item) => (item ? item.label : ""),
    inputValue: query,
    selectedItem,
    onInputValueChange: ({ inputValue, type }) => {
      if (type === useCombobox.stateChangeTypes.InputChange) {
        setQuery(inputValue || "");
      }
    },
    onIsOpenChange: ({ isOpen: open }) => {
      if (!open) setQuery("");
    },
    onSelectedItemChange: ({ selectedItem: newSelection }) => {
      if (newSelection) onChange(newSelection.id);
    },
  });

  useEffect(() => {
    // preventScroll: the narrative page tracks scroll position, so a focus-induced
    // scroll would jump to another section
    if (isOpen) inputRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  const plural = label.toLowerCase().endsWith("y")
    ? `${label.toLowerCase().slice(0, -1)}ies`
    : `${label.toLowerCase()}s`;
  const totalVisible = options.filter(({ hidden }) => !hidden).length;

  let previousGroup: string | undefined;
  return (
    <Container>
      <HiddenLabel {...getLabelProps()}>{label}</HiddenLabel>
      <ToggleButton
        type="button"
        {...getToggleButtonProps({ disabled })}
        tabIndex={0}
        aria-label={`${label} ${selectedItem?.label || ""}`.trim()}
      >
        <ButtonText>{selectedItem?.label || label}</ButtonText>
        <Caret />
      </ToggleButton>
      <Panel open={isOpen}>
        <div {...getComboboxProps()}>
          <SearchInput
            {...getInputProps({ ref: inputRef })}
            placeholder={`Search ${plural}`}
            aria-label={`Search ${plural}`}
          />
        </div>
        <OptionList {...getMenuProps()}>
          {isOpen && items.length === 0 && (
            <NoResults role="presentation">No matches</NoResults>
          )}
          {isOpen &&
            items.map((item, index) => {
              const heading =
                item.group && item.group !== previousGroup ? (
                  <GroupHeading role="presentation">{item.group}</GroupHeading>
                ) : null;
              previousGroup = item.group;
              return (
                <React.Fragment key={item.id}>
                  {heading}
                  <OptionRow
                    {...getItemProps({ item, index })}
                    highlighted={highlightedIndex === index}
                    selected={item.id === selectedId}
                  >
                    {item.label}
                  </OptionRow>
                </React.Fragment>
              );
            })}
        </OptionList>
        {isOpen && query && (
          <Count aria-live="polite">
            {items.length} of {totalVisible} shown
          </Count>
        )}
      </Panel>
    </Container>
  );
};

export default SearchableDropdown;
