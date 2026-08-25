interface BilingualProductNameProps {
  name: unknown;
  nameRo?: unknown;
}

function uppercase(value: unknown, locale: string) {
  return String(value || '').normalize('NFC').toLocaleUpperCase(locale);
}

export function BilingualProductName({ name, nameRo }: BilingualProductNameProps) {
  return (
    <div>
      <div className="font-bold tracking-wide text-slate-800">{uppercase(name, 'en-GB')}</div>
      <div className="mt-1 text-xs font-semibold tracking-wide text-slate-500">
        {uppercase(nameRo || name, 'ro-RO')}
      </div>
    </div>
  );
}
