function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase()
  if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) return new Uint8Array()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function makePasswordSaltHex(bytes = 16): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return bytesToHex(b)
}

export async function hashTournamentPassword(args: { password: string; saltHex: string }): Promise<string> {
  const { password, saltHex } = args
  const saltBytes = hexToBytes(saltHex)
  const enc = new TextEncoder()
  const pwBytes = enc.encode(password)
  const data = new Uint8Array(saltBytes.length + pwBytes.length)
  data.set(saltBytes, 0)
  data.set(pwBytes, saltBytes.length)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest))
}

export async function verifyTournamentPassword(args: {
  password: string
  saltHex: string
  expectedHashHex: string
}): Promise<boolean> {
  const next = await hashTournamentPassword({ password: args.password, saltHex: args.saltHex })
  return next === args.expectedHashHex.trim().toLowerCase()
}

