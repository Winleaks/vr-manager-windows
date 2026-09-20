/** Keep distinct catalog variants visible without duplicating an embedded label. */
export function productDisplayName(name: string, variant?: string | null): string {
  const base = name.trim();
  const label = variant?.trim();
  return !label || base.toLocaleLowerCase('en-GB').includes(label.toLocaleLowerCase('en-GB'))
    ? base : `${base} - ${label}`;
}
