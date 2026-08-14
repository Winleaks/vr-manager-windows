import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'

interface CredentialFile {
  version: 1
  values: Record<string, string>
}

function credentialFilePath() {
  return path.join(app.getPath('userData'), 'secure-credentials.json')
}

function emptyCredentialFile(): CredentialFile {
  return { version: 1, values: {} }
}

function readCredentialFile(): CredentialFile {
  const target = credentialFilePath()
  if (!fs.existsSync(target)) return emptyCredentialFile()

  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as Partial<CredentialFile>
    if (parsed.version === 1 && parsed.values && typeof parsed.values === 'object') {
      return { version: 1, values: parsed.values }
    }
  } catch {
    throw new Error('Fișierul securizat de credentiale nu poate fi citit.')
  }
  throw new Error('Formatul fișierului securizat de credentiale este invalid.')
}

function writeCredentialFile(data: CredentialFile) {
  const target = credentialFilePath()
  const temporary = `${target}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporary, target)
}

export function isCredentialStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false
  return true
}

export function getCredential(key: string) {
  if (!isCredentialStorageAvailable()) return null
  const encrypted = readCredentialFile().values[key]
  if (!encrypted) return null

  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return null
  }
}

export function setCredential(key: string, value: string) {
  if (!isCredentialStorageAvailable()) {
    throw new Error('Stocarea securizată a credentialelor nu este disponibilă pe acest sistem.')
  }

  const data = readCredentialFile()
  data.values[key] = safeStorage.encryptString(value).toString('base64')
  writeCredentialFile(data)
}

export function deleteCredential(key: string) {
  const data = readCredentialFile()
  if (!(key in data.values)) return
  delete data.values[key]
  writeCredentialFile(data)
}
