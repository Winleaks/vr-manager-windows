import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { normalizeNumericInput } from '../utils/numericInput';

interface NumericInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> {
  decimalScale?: number;
  integer?: boolean;
}

export function NumericInput({
  decimalScale = 2,
  integer = false,
  onChange,
  autoComplete = 'off',
  spellCheck = false,
  ...props
}: NumericInputProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeNumericInput(event.currentTarget.value, { integer, decimalScale });
    if (normalized === null) return;
    if (normalized !== event.currentTarget.value) event.currentTarget.value = normalized;
    onChange?.(event);
  };

  return (
    <input
      {...props}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete={autoComplete}
      spellCheck={spellCheck}
      onChange={handleChange}
    />
  );
}
