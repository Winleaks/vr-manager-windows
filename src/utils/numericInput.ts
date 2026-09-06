export function normalizeNumericInput(
  value: string,
  options: { integer?: boolean; decimalScale?: number } = {},
) {
  const decimalScale = Math.max(0, Math.trunc(options.decimalScale ?? 2));
  if (options.integer || decimalScale === 0) {
    return value.replace(',', '.').split('.')[0].replace(/\D/g, '');
  }

  const decimalNormalized = value.includes('.') && value.includes(',')
    ? value.replace(/,/g, '')
    : value.replace(/,/g, '.');
  const digitsAndSeparators = decimalNormalized.replace(/[^\d.]/g, '');
  const separatorIndex = digitsAndSeparators.indexOf('.');
  if (separatorIndex === -1) return digitsAndSeparators;

  const whole = digitsAndSeparators.slice(0, separatorIndex) || '0';
  const decimals = digitsAndSeparators.slice(separatorIndex + 1).replace(/\./g, '').slice(0, decimalScale);
  return `${whole}.${decimals}`;
}

export function normalizePinInput(value: string) {
  return value.replace(/\D/g, '').slice(0, 6);
}
