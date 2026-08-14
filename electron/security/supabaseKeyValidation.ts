export function assertSafeSupabaseClientKey(value: unknown) {
  if (typeof value !== 'string' || value.length < 20 || value.length > 4096) {
    throw new Error('Cheia Supabase este invalidă.')
  }

  if (value.startsWith('sb_secret_')) {
    throw new Error('Cheile Supabase secret nu sunt permise într-o aplicație desktop.')
  }
  if (value.startsWith('sb_publishable_')) return value

  const parts = value.split('.')
  if (parts.length !== 3) throw new Error('Folosește o cheie Supabase publishable/anon.')

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown }
    if (payload.role === 'service_role') {
      throw new Error('Cheia Supabase service_role nu este permisă într-o aplicație desktop.')
    }
    if (payload.role !== 'anon') throw new Error('Folosește o cheie Supabase publishable/anon.')
  } catch (error) {
    if (error instanceof Error && error.message.includes('Supabase')) throw error
    throw new Error('Cheia Supabase este invalidă.')
  }

  return value
}

export function isSafeSupabaseClientKey(value: unknown) {
  try {
    assertSafeSupabaseClientKey(value)
    return true
  } catch {
    return false
  }
}
