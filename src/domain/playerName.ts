export function getPlayerName(p?: { name?: string | null; firstName?: string | null; lastName?: string | null }): string {
  if (!p) return ''
  const n = String(p.name ?? '').trim()
  if (n.length) return n
  const legacy = `${String(p.firstName ?? '').trim()} ${String(p.lastName ?? '').trim()}`.trim()
  return legacy
}

export function getPlayerNameOr(
  p: { name?: string | null; firstName?: string | null; lastName?: string | null } | undefined,
  fallback: string,
): string {
  const s = getPlayerName(p)
  return s.length ? s : fallback
}

