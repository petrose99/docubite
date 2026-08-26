import { createCipheriv, createDecipheriv, randomBytes } from "crypto"
import config from "@/lib/config"

/** Symmetric encryption for secrets we must store and later read back in plaintext — webhook
 * signing secrets and OAuth connector tokens. This is NOT for anything we only ever compare
 * (API keys, invite tokens): those are hashed one-way (see models/workspaces.ts, lib/api-auth.ts).
 * Reach for this only when the plaintext genuinely has to leave the database again.
 *
 * Scheme: AES-256-GCM. The stored string is `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 * The `v1` prefix is a format version, not a key id — it lets a future scheme coexist. GCM gives
 * us authenticated encryption, so a tampered ciphertext fails to decrypt rather than returning
 * garbage.
 *
 * Rotation: `encrypt` always seals under the CURRENT key. `decrypt` tries the current key first,
 * then the PREVIOUS key if one is configured. To rotate, move the old key to
 * SECRETS_ENCRYPTION_KEY_PREVIOUS, set a fresh SECRETS_ENCRYPTION_KEY, and let values re-seal
 * lazily: callers that read-then-write (token refresh, secret edit) pass the decrypted value back
 * through `encrypt`, which stamps the new key. `needsReencryption` tells a caller whether a value
 * it just decrypted is still on an old key, so a read path can opt into eager re-sealing.
 *
 * The key is 32 random bytes, base64-encoded, in SECRETS_ENCRYPTION_KEY. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */

const VERSION = "v1"
const IV_BYTES = 12 // GCM standard nonce length
const KEY_BYTES = 32 // AES-256

export class SecretCryptoError extends Error {}

/** Decodes and validates a base64 key into a 32-byte Buffer. Throws with a stable, non-secret
 * message on anything malformed so a misconfigured deployment fails loudly at first use rather
 * than silently writing undecryptable data. */
export function parseKey(base64Key: string): Buffer {
  if (!base64Key) throw new SecretCryptoError("secrets_encryption_key_missing")
  let key: Buffer
  try {
    key = Buffer.from(base64Key, "base64")
  } catch {
    throw new SecretCryptoError("secrets_encryption_key_not_base64")
  }
  if (key.length !== KEY_BYTES) throw new SecretCryptoError("secrets_encryption_key_wrong_length")
  return key
}

/** Seals `plaintext` under `key` (a 32-byte Buffer). Pure: no config, no env. */
export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".")
}

/** Opens a `v1.<iv>.<tag>.<ct>` string with the first key that authenticates it. `keys` is tried
 * in order (current, then previous). Throws SecretCryptoError on a malformed string or if no key
 * authenticates — the two are indistinguishable to a caller and both mean "cannot read this". */
export function decryptWithKeys(ciphertext: string, keys: Buffer[]): string {
  const parts = ciphertext.split(".")
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretCryptoError("secret_ciphertext_malformed")
  const iv = Buffer.from(parts[1], "base64url")
  const tag = Buffer.from(parts[2], "base64url")
  const ct = Buffer.from(parts[3], "base64url")
  if (iv.length !== IV_BYTES || tag.length !== 16) throw new SecretCryptoError("secret_ciphertext_malformed")
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
    } catch {
      // Wrong key (or tampered ciphertext) → GCM auth fails here; fall through to the next key.
    }
  }
  throw new SecretCryptoError("secret_decrypt_failed")
}

/** Whether a value that decrypted successfully was sealed under a key OTHER than the current one,
 * i.e. it should be re-encrypted on its next write. Cheap enough to call on every decrypt: it
 * just re-runs the current-key-only decrypt and reports whether that succeeds. */
export function needsReencryptionWithKeys(ciphertext: string, currentKey: Buffer): boolean {
  try {
    decryptWithKeys(ciphertext, [currentKey])
    return false
  } catch {
    return true
  }
}

// --- Config-backed wrappers. These read the deployment's keys; keep them thin so the crypto core
// above stays testable without touching env. ---

function currentKey(): Buffer {
  return parseKey(config.integrations.encryptionKey)
}

/** All keys valid for DECRYPTION, current first, then previous if configured. */
function decryptionKeys(): Buffer[] {
  const keys = [currentKey()]
  if (config.integrations.encryptionKeyPrevious) keys.push(parseKey(config.integrations.encryptionKeyPrevious))
  return keys
}

export function encryptSecret(plaintext: string): string {
  return encryptWithKey(plaintext, currentKey())
}

export function decryptSecret(ciphertext: string): string {
  return decryptWithKeys(ciphertext, decryptionKeys())
}

/** True when `ciphertext` decrypts only under the previous key — a read path may re-seal it. */
export function secretNeedsReencryption(ciphertext: string): boolean {
  return needsReencryptionWithKeys(ciphertext, currentKey())
}
