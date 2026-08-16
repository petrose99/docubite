/** Invitation tokens are `randomBytes(32).toString("base64url")` (models/workspaces.ts), so the
 * alphabet is exactly [A-Za-z0-9_-]. Anything else is rejected before it is used to build a URL.
 *
 * This is what keeps `/login?invite=…` from being an open redirect: no caller-supplied URL is
 * ever accepted anywhere in this flow. The login page takes an opaque token, and the *server* rebuilds
 * `/invite/` + that one segment — the character class forbids `/`, `:`, `.` and `%`, so there is
 * no host, no scheme, and no path to escape into. Do not "simplify" this into a `?next=` param;
 * that refactor is precisely the hole this shape avoids. */
const INVITE_TOKEN = /^[A-Za-z0-9_-]{20,64}$/

export function parseInviteToken(value: unknown): string | null {
  return typeof value === "string" && INVITE_TOKEN.test(value) ? value : null
}
