import * as React from 'react';
import useEnhancedEffect from '@mui/utils/useEnhancedEffect';
import useEventCallback from '@mui/utils/useEventCallback';
import useForkRef from '@mui/utils/useForkRef';
import { MuiDateSectionName, MuiPickerFieldAdapter } from '../../models/muiPickersAdapter';
import { useValidation } from '../validation/useValidation';
import { useUtils } from '../useUtils';
import {
  FieldSection,
  UseFieldParams,
  UseFieldResponse,
  UseFieldForwardedProps,
  UseFieldInternalProps,
  AvailableAdjustKeyCode,
} from './useField.interfaces';
import {
  getMonthsMatchingQuery,
  getSectionValueNumericBoundaries,
  getSectionVisibleValue,
  adjustDateSectionValue,
  adjustInvalidDateSectionValue,
  applySectionValueToDate,
  cleanTrailingZeroInNumericSectionValue,
  isAndroid,
} from './useField.utils';
import { useFieldState } from './useFieldState';

export const useField = <
  TValue,
  TDate,
  TSection extends FieldSection,
  TForwardedProps extends UseFieldForwardedProps,
  TInternalProps extends UseFieldInternalProps<any, any>,
>(
  params: UseFieldParams<TValue, TDate, TSection, TForwardedProps, TInternalProps>,
): UseFieldResponse<TForwardedProps> => {
  const utils = useUtils<TDate>() as MuiPickerFieldAdapter<TDate>;
  if (!utils.formatTokenMap) {
    throw new Error('This adapter is not compatible with the field components');
  }
  const queryRef = React.useRef<{ dateSectionName: MuiDateSectionName; value: string } | null>(
    null,
  );

  const {
    state,
    selectedSectionIndexes,
    setSelectedSections,
    clearValue,
    clearActiveSection,
    updateSectionValue,
    setTempAndroidValueStr,
  } = useFieldState(params);

  const {
    inputRef: inputRefProp,
    internalProps: { readOnly = false },
    forwardedProps: { onClick, onKeyDown, onFocus, onBlur, ...otherForwardedProps },
    fieldValueManager,
    validator,
  } = params;

  const inputRef = React.useRef<HTMLInputElement>(null);
  const handleRef = useForkRef(inputRefProp, inputRef);

  const focusTimeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined);

  const handleInputClick = useEventCallback((...args) => {
    onClick?.(...(args as []));

    const nextSectionIndex = state.sections.findIndex(
      (section) => section.start > (inputRef.current!.selectionStart ?? 0),
    );
    const sectionIndex = nextSectionIndex === -1 ? state.sections.length - 1 : nextSectionIndex - 1;

    setSelectedSections(sectionIndex);
  });

  const handleInputFocus = useEventCallback((...args) => {
    onFocus?.(...(args as []));
    // The ref is guaranteed to be resolved that this point.
    const input = inputRef.current as HTMLInputElement;

    clearTimeout(focusTimeoutRef.current);
    focusTimeoutRef.current = setTimeout(() => {
      // The ref changed, the component got remounted, the focus event is no longer relevant.
      if (input !== inputRef.current) {
        return;
      }

      if (Number(input.selectionEnd) - Number(input.selectionStart) === input.value.length) {
        setSelectedSections({ startIndex: 0, endIndex: state.sections.length - 1 });
      } else {
        handleInputClick();
      }
    });
  });

  const handleInputBlur = useEventCallback((...args) => {
    onBlur?.(...(args as []));
    setSelectedSections(null);
  });

  const handleInputPaste = useEventCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    if (readOnly || selectedSectionIndexes == null) {
      return;
    }

    event.preventDefault();
    const pastedValue = event.clipboardData.getData('text');
    throw new Error(`Pasting is not implemented yet, the value to paste would be "${pastedValue}"`);
  });

  const handleInputChange = useEventCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly || selectedSectionIndexes == null) {
      return;
    }

    const prevValueStr = fieldValueManager.getValueStrFromSections(state.sections);
    const valueStr = event.target.value;

    let startOfDiffIndex = -1;
    let endOfDiffIndex = -1;
    for (let i = 0; i < prevValueStr.length; i += 1) {
      if (startOfDiffIndex === -1 && prevValueStr[i] !== valueStr[i]) {
        startOfDiffIndex = i;
      }

      if (
        endOfDiffIndex === -1 &&
        prevValueStr[prevValueStr.length - i - 1] !== valueStr[valueStr.length - i - 1]
      ) {
        endOfDiffIndex = i;
      }
    }

    const activeSection = state.sections[selectedSectionIndexes.startIndex];

    const hasDiffOutsideOfActiveSection =
      startOfDiffIndex < activeSection.start ||
      prevValueStr.length - endOfDiffIndex - 1 > activeSection.end;

    if (hasDiffOutsideOfActiveSection) {
      // TODO: Support if the new date is valid
      return;
    }

    // The active section being selected, the browser has replaced its value with the key pressed by the user.
    const activeSectionEndRelativeToNewValue =
      valueStr.length -
      prevValueStr.length +
      activeSection.end -
      (activeSection.separator?.length ?? 0);
    const keyPressed = valueStr.slice(activeSection.start, activeSectionEndRelativeToNewValue);

    if (isAndroid() && keyPressed.length === 0) {
      setTempAndroidValueStr(valueStr);
      return;
    }

    const isNumericValue = !Number.isNaN(Number(keyPressed));

    if (isNumericValue) {
      const getNewSectionValueStr = (date: TDate) => {
        const boundaries = getSectionValueNumericBoundaries(
          utils,
          date,
          activeSection.dateSectionName,
        );

        // Remove the trailing `0` (`01` => `1`)
        const currentSectionValue = Number(activeSection.value).toString();

        let newSectionValue = `${currentSectionValue}${keyPressed}`;
        while (newSectionValue.length > 0 && Number(newSectionValue) > boundaries.maximum) {
          newSectionValue = newSectionValue.slice(1);
        }

        // In the unlikely scenario where max < 9, we could type a single digit that already exceeds the maximum.
        if (newSectionValue.length === 0) {
          newSectionValue = boundaries.minimum.toString();
        }

        return cleanTrailingZeroInNumericSectionValue(newSectionValue, boundaries.maximum);
      };

      updateSectionValue({
        activeSection,
        setSectionValueOnDate: (activeDate) => {
          if (activeSection.contentType === 'letter') {
            return activeDate;
          }

          return applySectionValueToDate({
            utils,
            dateSectionName: activeSection.dateSectionName,
            date: activeDate,
            getSectionValue: (getter) => {
              const sectionValueStr = getNewSectionValueStr(activeDate);
              const sectionDate = utils.parse(sectionValueStr, activeSection.formatValue)!;
              return getter(sectionDate);
            },
          });
        },
        setSectionValueOnSections: (referenceActiveDate) =>
          getNewSectionValueStr(referenceActiveDate),
      });
    }
    // TODO: Improve condition
    else if (['/', ' ', '-'].includes(keyPressed)) {
      if (selectedSectionIndexes.startIndex < state.sections.length - 1) {
        setSelectedSections(selectedSectionIndexes.startIndex + 1);
      }
    } else {
      if (keyPressed.length > 1) {
        // TODO: Might be able to support it in some scenario
        return;
      }

      const getNewSectionValueStr = (): string => {
        if (activeSection.contentType === 'digit') {
          return activeSection.value;
        }

        const newQuery = keyPressed.toLowerCase();
        const currentQuery =
          queryRef.current?.dateSectionName === activeSection.dateSectionName
            ? queryRef.current!.value
            : '';
        const concatenatedQuery = `${currentQuery}${newQuery}`;
        const matchingMonthsWithConcatenatedQuery = getMonthsMatchingQuery(
          utils,
          activeSection.formatValue,
          concatenatedQuery,
        );
        if (matchingMonthsWithConcatenatedQuery.length > 0) {
          queryRef.current = {
            dateSectionName: activeSection.dateSectionName,
            value: concatenatedQuery,
          };
          return matchingMonthsWithConcatenatedQuery[0];
        }

        const matchingMonthsWithNewQuery = getMonthsMatchingQuery(
          utils,
          activeSection.formatValue,
          newQuery,
        );
        if (matchingMonthsWithNewQuery.length > 0) {
          queryRef.current = {
            dateSectionName: activeSection.dateSectionName,
            value: newQuery,
          };
          return matchingMonthsWithNewQuery[0];
        }

        return activeSection.value;
      };

      updateSectionValue({
        activeSection,
        setSectionValueOnDate: (activeDate) =>
          applySectionValueToDate({
            utils,
            dateSectionName: activeSection.dateSectionName,
            date: activeDate,
            getSectionValue: (getter) => {
              const sectionValueStr = getNewSectionValueStr();
              const sectionDate = utils.parse(sectionValueStr, activeSection.formatValue)!;
              return getter(sectionDate);
            },
          }),
        setSectionValueOnSections: () => getNewSectionValueStr(),
      });
    }
  });

  const handleInputKeyDown = useEventCallback((event: React.KeyboardEvent) => {
    onKeyDown?.(event);

    // eslint-disable-next-line default-case
    switch (true) {
      // Select all
      case event.key === 'a' && (event.ctrlKey || event.metaKey): {
        // prevent default to make sure that the next line "select all" while updating
        // the internal state at the same time.
        event.preventDefault();
        setSelectedSections({ startIndex: 0, endIndex: state.sections.length - 1 });
        break;
      }

      // Move selection to next section
      case event.key === 'ArrowRight': {
        event.preventDefault();

        if (selectedSectionIndexes == null) {
          setSelectedSections(0);
        } else if (selectedSectionIndexes.startIndex < state.sections.length - 1) {
          setSelectedSections(selectedSectionIndexes.startIndex + 1);
        } else if (selectedSectionIndexes.startIndex !== selectedSectionIndexes.endIndex) {
          setSelectedSections(selectedSectionIndexes.endIndex);
        }
        break;
      }

      // Move selection to previous section
      case event.key === 'ArrowLeft': {
        event.preventDefault();

        if (selectedSectionIndexes == null) {
          setSelectedSections(state.sections.length - 1);
        } else if (selectedSectionIndexes.startIndex !== selectedSectionIndexes.endIndex) {
          setSelectedSections(selectedSectionIndexes.startIndex);
        } else if (selectedSectionIndexes.startIndex > 0) {
          setSelectedSections(selectedSectionIndexes.startIndex - 1);
        }
        break;
      }

      // Reset the value of the selected section
      case ['Backspace', 'Delete'].includes(event.key): {
        event.preventDefault();

        if (readOnly) {
          break;
        }

        if (
          selectedSectionIndexes == null ||
          (selectedSectionIndexes.startIndex === 0 &&
            selectedSectionIndexes.endIndex === state.sections.length - 1)
        ) {
          clearValue();
        } else {
          clearActiveSection();
        }
        break;
      }

      // Increment / decrement the selected section value
      case ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key): {
        event.preventDefault();

        if (readOnly || selectedSectionIndexes == null) {
          break;
        }

        const activeSection = state.sections[selectedSectionIndexes.startIndex];

        updateSectionValue({
          activeSection,
          setSectionValueOnDate: (activeDate) =>
            adjustDateSectionValue(
              utils,
              activeDate,
              activeSection.dateSectionName,
              event.key as AvailableAdjustKeyCode,
            ),
          setSectionValueOnSections: () =>
            adjustInvalidDateSectionValue(
              utils,
              activeSection,
              event.key as AvailableAdjustKeyCode,
            ),
        });
        break;
      }
    }
  });

  useEnhancedEffect(() => {
    if (selectedSectionIndexes == null) {
      return;
    }

    const updateSelectionRangeIfChanged = (selectionStart: number, selectionEnd: number) => {
      if (
        selectionStart !== inputRef.current!.selectionStart ||
        selectionEnd !== inputRef.current!.selectionEnd
      ) {
        inputRef.current!.setSelectionRange(selectionStart, selectionEnd);
      }
    };

    const firstSelectedSection = state.sections[selectedSectionIndexes.startIndex];
    const lastSelectedSection = state.sections[selectedSectionIndexes.endIndex];
    updateSelectionRangeIfChanged(
      firstSelectedSection.start,
      lastSelectedSection.start + getSectionVisibleValue(lastSelectedSection).length,
    );
  });

  const validationError = useValidation(
    { ...params.internalProps, value: state.value },
    validator,
    fieldValueManager.isSameError,
  );

  const inputError = React.useMemo(
    () => fieldValueManager.hasError(validationError),
    [fieldValueManager, validationError],
  );

  React.useEffect(() => {
    return () => window.clearTimeout(focusTimeoutRef.current);
  }, []);

  const valueStr = React.useMemo(
    () => state.tempValueStrAndroid ?? fieldValueManager.getValueStrFromSections(state.sections),
    [state.sections, fieldValueManager, state.tempValueStrAndroid],
  );

  const inputMode = React.useMemo(() => {
    if (selectedSectionIndexes == null) {
      return 'text';
    }

    if (state.sections[selectedSectionIndexes.startIndex].contentType === 'letter') {
      return 'text';
    }

    return 'tel';
  }, [selectedSectionIndexes, state.sections]);

  return {
    ...otherForwardedProps,
    value: valueStr,
    inputMode,
    onClick: handleInputClick,
    onFocus: handleInputFocus,
    onBlur: handleInputBlur,
    onPaste: handleInputPaste,
    onChange: handleInputChange,
    onKeyDown: handleInputKeyDown,
    error: inputError,
    ref: handleRef,
  };
};
