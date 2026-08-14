import path from 'path'

export const MAX_EXPORT_BYTES = 50 * 1024 * 1024
export const MAX_PDF_BYTES = 25 * 1024 * 1024

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const WINDOWS_FORBIDDEN_CHARACTERS = /[<>:"/\\|?*\p{Cc}]/u

export function validatePdfFilename(value: unknown) {
  if (typeof value !== 'string') throw new Error('Numele PDF-ului este invalid.')

  const filename = value.normalize('NFC').trim()
  if (!filename || filename.length > 180) throw new Error('Numele PDF-ului este invalid.')
  if (filename !== path.basename(filename) || WINDOWS_FORBIDDEN_CHARACTERS.test(filename)) {
    throw new Error('Numele PDF-ului conține caractere nepermise.')
  }
  if (filename.endsWith('.') || filename.endsWith(' ') || WINDOWS_RESERVED_NAME.test(filename)) {
    throw new Error('Numele PDF-ului este rezervat de sistem.')
  }
  if (path.extname(filename).toLowerCase() !== '.pdf') {
    throw new Error('Fișierul trebuie să aibă extensia PDF.')
  }

  return filename
}

export function resolvePdfPath(directory: string, filenameValue: unknown) {
  const filename = validatePdfFilename(filenameValue)
  const root = path.resolve(directory)
  const target = path.resolve(root, filename)

  if (path.dirname(target) !== root) throw new Error('Calea PDF-ului este invalidă.')
  return target
}

export function toBoundedBuffer(value: unknown, maximumBytes = MAX_EXPORT_BYTES) {
  if (!(value instanceof Uint8Array)) throw new Error('Conținutul fișierului este invalid.')
  if (value.byteLength === 0 || value.byteLength > maximumBytes) {
    throw new Error('Dimensiunea fișierului nu este permisă.')
  }
  return Buffer.from(value)
}

export function toValidatedPdfBuffer(value: unknown) {
  const buffer = toBoundedBuffer(value, MAX_PDF_BYTES)
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('Conținutul nu este un document PDF valid.')
  }
  return buffer
}

export function validateCloudFileId(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(value)) {
    throw new Error('Identificatorul backup-ului cloud este invalid.')
  }
  return value
}
