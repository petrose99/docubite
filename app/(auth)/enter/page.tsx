import { redirect } from "next/navigation"

/** The old OTP entry point. Kept as a redirect rather than deleted: it is the URL in every
 * invitation email sent before the switch to passwords, and in anyone's bookmarks. The invite
 * token has to survive the hop or those links land on a login page that has forgotten why the
 * visitor came. */
export default async function EnterPage({ searchParams }: { searchParams: Promise<{ invite?: string | string[] }> }) {
  const { invite } = await searchParams
  const token = Array.isArray(invite) ? invite[0] : invite
  redirect(token ? `/login?invite=${encodeURIComponent(token)}` : "/login")
}
