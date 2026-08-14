import { deleteCredential, getCredential, setCredential } from '../security/credentialStore';

const VR_BAKER_API_TOKEN_KEY = 'vr-baker-api-token';
const LEGACY_SUPABASE_PASSWORD_KEY = 'supabase-password';

export function getVrBakerApiToken() {
  return getCredential(VR_BAKER_API_TOKEN_KEY);
}

export function hasVrBakerApiToken() {
  return Boolean(getVrBakerApiToken());
}

export function setVrBakerApiToken(token: string) {
  const normalized = token.trim();
  if (normalized.length < 32 || normalized.length > 512 || /\s/.test(normalized)) {
    throw new Error('Tokenul VR Baker API este invalid.');
  }
  setCredential(VR_BAKER_API_TOKEN_KEY, normalized);
}

export function removeLegacySupabaseCredential() {
  deleteCredential(LEGACY_SUPABASE_PASSWORD_KEY);
}
