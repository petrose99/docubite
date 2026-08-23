import { MfaEnroll } from "@/components/auth/mfa-enroll"
import { SignOutEverywhereButton } from "@/components/auth/sign-out-everywhere-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"

/** Account-level settings, not workspace-level — MFA and sessions belong to the Supabase identity,
 * not any one workspace — but there is no standalone account-settings area in this app, so this
 * lives alongside Workspace/Billing/Templates the same way every other settings page does. */
export default async function SecuritySettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  await params
  await getCurrentUser()

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Security</h1>
      <p className="mt-1 text-muted-foreground">Two-factor authentication and session controls for your account.</p>
    </header>

    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>Required to open a workspace with HIPAA mode on.</CardDescription>
      </CardHeader>
      <CardContent>
        <MfaEnroll />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>If you signed in somewhere you don&apos;t recognize, end every session at once.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignOutEverywhereButton />
      </CardContent>
    </Card>
  </main>
}
