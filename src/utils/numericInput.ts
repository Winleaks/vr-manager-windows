export function normalizeNumericInput(
  value: string,
  options: { integer?: boolean; decimalScale?: number } = {},
) {
  const normalized = value.replace(',', '.');
  const decimalScale = Math.max(0, Math.trunc(options.decimalScale ?? 2));
  const valid = options.integer
    ? /^\d*$/.test(normalized)
    : new RegExp(`^\\d*(?:\\.\\d{0,${decimalScale}})?$`).test(normalized);
  return valid ? normalized : null;
}
