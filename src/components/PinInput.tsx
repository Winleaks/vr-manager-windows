import type { InputHTMLAttributes } from 'react';
import { normalizePinInput } from '../utils/numericInput';

interface PinInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'maxLength' | 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
}

export function PinInput({ value, onValueChange, autoComplete = 'off', spellCheck = false, ...props }: PinInputProps) {
  return <input
    {...props}
    type="text"
    inputMode="numeric"
    pattern="[0-9]*"
    maxLength={6}
    value={value}
    autoComplete={autoComplete}
    spellCheck={spellCheck}
    onChange={(event) => onValueChange(normalizePinInput(event.currentTarget.value))}
    className={`secure-pin-input ${props.className || ''}`}
  />;
}
