import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { normalizeNumericInput } from '../utils/numericInput';

interface NumericInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'value' | 'defaultValue' | 'onChange'> {
  decimalScale?: number;
  integer?: boolean;
  value: string | number;
  onValueChange: (value: string) => void;
}

export function NumericInput({
  decimalScale = 2,
  integer = false,
  value,
  onValueChange,
  autoComplete = 'off',
  spellCheck = false,
  ...props
}: NumericInputProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeNumericInput(event.currentTarget.value, { integer, decimalScale });
    onValueChange(normalized);
  };

  return (
    <input
      {...props}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={String(value ?? '')}
      autoComplete={autoComplete}
      spellCheck={spellCheck}
      onChange={handleChange}
    />
  );
}
