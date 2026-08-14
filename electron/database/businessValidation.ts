export function requirePositiveInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} trebuie să fie un număr întreg pozitiv.`);
  }
  return Number(value);
}

export function requireFinitePositive(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} trebuie să fie un număr finit mai mare decât zero.`);
  }
  return value;
}

export function requireFiniteNonNegative(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} trebuie să fie un număr finit pozitiv sau zero.`);
  }
  return value;
}

export function requireMoneyNonNegative(value: unknown, label: string) {
  const amount = requireFiniteNonNegative(value, label);
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  if (Math.abs(amount - rounded) > 1e-9) {
    throw new Error(`${label} trebuie să aibă maximum două zecimale.`);
  }
  return rounded;
}

export function requireMoneyPositive(value: unknown, label: string) {
  const amount = requireMoneyNonNegative(value, label);
  if (amount <= 0) throw new Error(`${label} trebuie să fie mai mare decât zero.`);
  return amount;
}

export function requireText(value: unknown, label: string, maxLength = 500) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new Error(`${label} este obligatoriu și trebuie să aibă maximum ${maxLength} caractere.`);
  }
  return value.trim();
}

export function optionalText(value: unknown, label: string, maxLength = 2000) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new Error(`${label} trebuie să aibă maximum ${maxLength} caractere.`);
  }
  return value.trim() || null;
}

export function requireIsoDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} trebuie să fie în format YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} nu este o dată calendaristică validă.`);
  }
  return value;
}
