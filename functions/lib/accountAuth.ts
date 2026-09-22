// Password hashing for Account (see CONTEXT.md) — deliberately separate
// from functions/lib/auth.ts's verifyAdmin, which is Cloudflare Access JWT
// verification and has no password involved at all. Uses only
// crypto.subtle (Workers-native, already used for sha256Hex in
// functions/lib/jobs.ts) rather than adding a bcrypt-style dependency,
// since native Node modules aren't available in the Workers runtime.

// OWASP's current PBKDF2-SHA256 guidance is 210,000, but the Workers
// runtime's crypto.subtle hard-caps PBKDF2 at 100,000 iterations and
// throws NotSupportedError above it — confirmed the hard way: this passed
// local `wrangler pages dev` testing (its crypto.subtle doesn't enforce the
// cap) and only failed once deployed to the real production runtime. 100k
// is itself long-standing OWASP guidance (their minimum for years before
// the 210k figure), so this isn't a weak fallback, just the ceiling this
// runtime actually allows.
const ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;
const SCHEME = "pbkdf2-sha256";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(bits);
}

/** Stored as "pbkdf2-sha256:<iterations>:<salt-b64>:<hash-b64>" — a
 * self-describing string so a future iteration-count increase doesn't
 * invalidate existing hashes (each verify reads the count that was
 * actually used, rather than a hardcoded constant). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const hash = await deriveBits(password, salt, ITERATIONS);
  return `${SCHEME}:${ITERATIONS}:${toBase64(salt)}:${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsStr, saltB64, hashB64] = stored.split(":");
  if (scheme !== SCHEME || !iterationsStr || !saltB64 || !hashB64) return false;

  const iterations = Number(iterationsStr);
  const salt = fromBase64(saltB64);
  const expected = fromBase64(hashB64);
  const actual = await deriveBits(password, salt, iterations);

  if (actual.length !== expected.length) return false;
  // Constant-time compare — a length/early-exit comparison here would leak
  // how many leading bytes of the hash matched via response timing.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
