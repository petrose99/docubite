import { TeamWorkspaceForm } from "@/components/workspace/team-workspace-form"
import { getViewerUser } from "@/lib/auth"
import config from "@/lib/config"
import { redirect } from "next/navigation"

export default async function CreateWorkspacePage() {
  const user = await getViewerUser()
  if (!user) redirect(config.auth.loginUrl)

  return <main className="mx-auto max-w-4xl space-y-8 p-8">
    <header className="space-y-1 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Create a workspace</h1>
      <p className="text-sm text-muted-foreground">A separate workspace with its own files, members, and usage.</p>
    </header>
    <TeamWorkspaceForm />
  </main>
}

export const dynamic = "force-dynamic"
