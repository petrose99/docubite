import { isIP } from "net"
import { lookup } from "dns/promises"

/** SSRF guard for user-supplied webhook URLs. A workspace owner types a URL we will later POST to
 * from our own network, so an unguarded fetch is a server-side request forgery primitive: it could
 * be pointed at `http://169.254.169.254/` (cloud metadata), `http://127.0.0.1:6379` (a local
 * Redis), or an internal service. We defend in layers:
 *
 *   1. Scheme must be https (localhost http is allowed only in dev, for a local receiver).
 *   2. The host must not be a literal private/loopback/link-local/metadata IP.
 *   3. Every A/AAAA the host resolves to must be public — a hostname that resolves to 127.0.0.1
 *      is just as dangerous as the literal.
 *
 * This is checked at registration time (fail fast, clear error) AND again at delivery time
 * (`deliverWebhook`), because DNS can change between the two. It does not fully close DNS
 * rebinding — the name could resolve to a public IP at check time and a private one microseconds
 * later at connect time; pinning the resolved IP into the fetch is a documented follow-up. Also
 * set `redirect: "manual"` on the actual fetch so a 3xx to an internal URL cannot bypass this.
 *
 * The range classification (`isBlockedIp`) is pure and table-tested. The resolver in `assertUrlSafe`
 * is injectable so the async path is testable without real DNS. */

export class UnsafeUrlError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code)
  }
}

// [network, prefixBits] pairs, expressed as byte arrays. Anything matching is refused.
const BLOCKED_V4: Array<[number[], number]> = [
  [[0, 0, 0, 0], 8], // "this" network
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local (incl. 169.254.169.254 cloud metadata)
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // TEST-NET-1
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // TEST-NET-2
  [[203, 0, 113, 0], 24], // TEST-NET-3
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved (incl. 255.255.255.255)
]

const LOOPBACK_V6 = new Array(15).fill(0).concat(1) // ::1 — the 1 is the LAST byte, not the first
const BLOCKED_V6: Array<[number[], number]> = [
  [bytes16([0]), 128], // :: unspecified
  [LOOPBACK_V6, 128], // ::1 loopback
  [bytes16([0x01, 0x00]), 64], // 100::/64 discard-only
  [bytes16([0xfc, 0x00]), 7], // fc00::/7 unique-local
  [bytes16([0xfe, 0x80]), 10], // fe80::/10 link-local
  [bytes16([0xff, 0x00]), 8], // ff00::/8 multicast
  [bytes16([0x20, 0x01, 0x0d, 0xb8]), 32], // 2001:db8::/32 documentation
]

function bytes16(prefix: number[]): number[] {
  const b = new Array(16).fill(0)
  for (let i = 0; i < prefix.length; i++) b[i] = prefix[i]
  return b
}

function inCidr(addr: number[], network: number[], prefixBits: number): boolean {
  let bits = prefixBits
  for (let i = 0; i < addr.length && bits > 0; i++) {
    const take = Math.min(8, bits)
    const mask = take === 0 ? 0 : (0xff << (8 - take)) & 0xff
    if ((addr[i] & mask) !== (network[i] & mask)) return false
    bits -= take
  }
  return true
}

export function ipv4ToBytes(ip: string): number[] | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    bytes.push(n)
  }
  return bytes
}

export function ipv6ToBytes(ip: string): number[] | null {
  const addr = ip.split("%")[0] // strip zone id
  if (addr.indexOf("::") !== addr.lastIndexOf("::")) return null // at most one "::"
  const [headStr, tailStr] = addr.includes("::") ? addr.split("::") : [addr, ""]
  const head = headStr ? headStr.split(":") : []
  const tail = tailStr ? tailStr.split(":") : []

  // A trailing group may be a dotted-quad IPv4 (e.g. ::ffff:1.2.3.4). Expand it to two hextets.
  const expandTail = (groups: string[]): string[] | null => {
    if (!groups.length) return groups
    const last = groups[groups.length - 1]
    if (!last.includes(".")) return groups
    const v4 = ipv4ToBytes(last)
    if (!v4) return null
    const hex = [((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16)]
    return [...groups.slice(0, -1), ...hex]
  }
  const headE = expandTail(head)
  const tailE = expandTail(tail)
  if (!headE || !tailE) return null

  const missing = 8 - (headE.length + tailE.length)
  if (missing < 0) return null
  if (!addr.includes("::") && missing !== 0) return null // no "::" means all 8 groups required
  const groups = [...headE, ...new Array(missing).fill("0"), ...tailE]
  if (groups.length !== 8) return null

  const bytes: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    const n = parseInt(g, 16)
    bytes.push((n >> 8) & 0xff, n & 0xff)
  }
  return bytes
}

/** True if `ip` is a literal address in a private/loopback/link-local/reserved/metadata range —
 * i.e. one we must never let a webhook point at. IPv4-mapped and NAT64-embedded IPv6 addresses are
 * unwrapped so `::ffff:127.0.0.1` is caught by the IPv4 table. Anything unparseable is treated as
 * blocked (fail closed). Pure. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const bytes = ipv4ToBytes(ip)
    return bytes ? BLOCKED_V4.some(([n, p]) => inCidr(bytes, n, p)) : true
  }
  if (kind === 6) {
    const bytes = ipv6ToBytes(ip)
    if (!bytes) return true
    // Unwrap ::ffff:0:0/96 (v4-mapped) and 64:ff9b::/96 (NAT64) to their embedded IPv4.
    const isV4Mapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff
    const isNat64 = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((b) => b === 0)
    if (isV4Mapped || isNat64) return isBlockedIp(bytes.slice(12).join("."))
    return BLOCKED_V6.some(([n, p]) => inCidr(bytes, n, p))
  }
  return true // not a valid IP literal
}

export type ResolvedAddress = { address: string }
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

const defaultResolver: Resolver = async (hostname) => lookup(hostname, { all: true, verbatim: true })

/** Validates a user-supplied webhook URL. Throws UnsafeUrlError with a stable `code` on rejection;
 * returns the parsed URL on success. `allowLocalhost` (default from NODE_ENV) permits http and
 * loopback so a developer can point a webhook at their own machine. `resolve` is injectable for
 * tests. */
export async function assertUrlSafe(
  rawUrl: string,
  opts: { allowLocalhost?: boolean; resolve?: Resolver } = {}
): Promise<URL> {
  const allowLocalhost = opts.allowLocalhost ?? process.env.NODE_ENV !== "production"
  const resolve = opts.resolve ?? defaultResolver

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeUrlError("url_invalid", "URL could not be parsed")
  }

  if (url.protocol !== "https:" && !(allowLocalhost && url.protocol === "http:")) {
    throw new UnsafeUrlError("url_scheme_not_https", "Webhook URLs must use https")
  }
  if (url.username || url.password) throw new UnsafeUrlError("url_has_credentials", "URL must not embed credentials")

  const host = url.hostname.replace(/^\[|\]$/g, "") // strip IPv6 brackets

  const localHostnames = new Set(["localhost", "localhost.localdomain"])
  const isLocalName = localHostnames.has(host.toLowerCase())

  // A literal IP host: classify it directly, no DNS.
  if (isIP(host)) {
    if (isBlockedIp(host) && !(allowLocalhost && (host === "127.0.0.1" || host === "::1"))) {
      throw new UnsafeUrlError("url_private_ip", "URL resolves to a private or reserved address")
    }
    return url
  }

  if (isLocalName) {
    if (allowLocalhost) return url
    throw new UnsafeUrlError("url_private_ip", "URL resolves to a private or reserved address")
  }

  // A hostname: every address it resolves to must be public.
  let addresses: ResolvedAddress[]
  try {
    addresses = await resolve(host)
  } catch {
    throw new UnsafeUrlError("url_dns_failed", "Host could not be resolved")
  }
  if (!addresses.length) throw new UnsafeUrlError("url_dns_failed", "Host did not resolve to any address")
  for (const { address } of addresses) {
    if (isBlockedIp(address)) throw new UnsafeUrlError("url_private_ip", "URL resolves to a private or reserved address")
  }
  return url
}
