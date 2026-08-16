import { SignOutButton } from "@/components/auth/sign-out-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getViewerUser } from "@/lib/auth"
import { acceptWorkspaceInvitation } from "@/models/workspaces"
import type { Route } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

const shell = (children: React.ReactNode) => <main className="mx-auto mt-20 max-w-lg p-5">{children}</main>

/** Resolves the viewer instead of requiring one with getCurrentUser(): that redirects anonymous
 * visitors to the login page and throws the token away, which is exactly why an invited stranger
 * could never get in. getViewerUser still applies the suspension check, so a suspended account
 * cannot accept its way into a new workspace. */
export default async function AcceptInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await getViewerUser()

  if (!user) {
    // Rendered, not redirected. A redirect would put the token in a Location header and then in
    // the Referer of everything the login page loads; a link the visitor clicks keeps it to one hop.
    return shell(<Card>
      <CardHeader>
        <CardTitle>You have been invited to a workspace</CardTitle>
        <CardDescription>Sign in — or create an account — with the email address the invitation was sent to, and you will be added automatically.</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href={`/login?invite=${encodeURIComponent(token)}` as Route} className="inline-flex items-center rounded-md bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Continue</Link>
      </CardContent>
    </Card>)
  }

  let workspaceId: string
  try {
    workspaceId = await acceptWorkspaceInvitation(token, user)
  } catch (error) {
    const mismatch = error instanceof Error && error.message === "invitation_email_mismatch"
    return shell(<Card>
      <CardHeader>
        <CardTitle>{mismatch ? "This invitation is for a different account" : "Invitation unavailable"}</CardTitle>
        <CardDescription>
          {mismatch
            ? `You are signed in as ${user.email}. Sign out and sign back in with the invited address to accept.`
            : "This invitation has expired or has already been used. Ask the workspace owner to send a new one."}
        </CardDescription>
      </CardHeader>
      {mismatch && <CardContent><SignOutButton label="Sign out" redirectTo={`/invite/${encodeURIComponent(token)}`} /></CardContent>}
    </Card>)
  }
  redirect(`/workspaces/${workspaceId}/files`)
}
