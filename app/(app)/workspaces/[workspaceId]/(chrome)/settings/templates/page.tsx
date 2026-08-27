import { DomainPackPicker } from "@/components/workspace/domain-pack-picker"
import { TemplateForm } from "@/components/workspace/template-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { extractionDomainPacks } from "@/lib/domains"
import { listFiles } from "@/models/files"
import { prisma } from "@/lib/db"
import { requireWorkspaceRole } from "@/models/workspaces"
import Link from "next/link"

/** Templates are worksheets, and worksheets now belong to a file — their codes are only unique
 * within one — so this page lists them grouped by file and makes the target file explicit when
 * creating one. */
export default async function TemplatesPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  const [files, templates] = await Promise.all([
    listFiles(workspaceId, { sort: "name", dir: "asc" }),
    prisma.documentTemplate.findMany({ where: { workspaceId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] }),
  ])
  const byFile = new Map(files.map((file) => [file.id, templates.filter((template) => template.fileId === file.id)]))
  const dictationEnabled = config.asr.enabled && membership.workspace.productMode === "clinical"
  const domainPacks = extractionDomainPacks()

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Document templates</h1>
      <p className="mt-1 text-muted-foreground">Every file starts with Invoice, Receipt, and Custom document. Custom templates support PDFs and images only.</p>
      {dictationEnabled && <p className="mt-2 text-sm text-muted-foreground">
        Looking for the format a dictated case is written up in? That is{" "}
        <Link className="font-medium text-emerald-700 hover:underline" href={`/workspaces/${workspaceId}/settings/reports`}>Report templates</Link>.
      </p>}
    </header>

    <div className="space-y-4">
      {files.map((file) => {
        const fileTemplates = byFile.get(file.id) || []
        const presentCodes = new Set(fileTemplates.map((template) => template.code))
        const availablePacks = domainPacks.filter((pack) => pack.adapters.some((adapter) => !presentCodes.has(adapter.code)))
        return <Card key={file.id}>
          <CardHeader>
            <CardTitle><Link className="hover:underline" href={`/workspaces/${workspaceId}/files/${file.id}/sheet`}>{file.name}</Link></CardTitle>
            <CardDescription>{fileTemplates.length} worksheet{fileTemplates.length === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1 text-sm">
              {fileTemplates.map((template) => <li key={template.id} className="flex items-center justify-between gap-3 rounded border px-3 py-2">
                <span className="font-medium">{template.name}</span>
                <span className="text-xs text-muted-foreground">{template.isSystem ? "System" : `Custom · version ${template.currentVersion}`}</span>
              </li>)}
            </ul>
            {membership.role === "owner" && <DomainPackPicker workspaceId={workspaceId} fileId={file.id} packs={availablePacks} />}
          </CardContent>
        </Card>
      })}
      {!files.length && <p className="text-sm text-muted-foreground">No files yet — create one from the Files list.</p>}
    </div>

    {membership.role === "owner" && files.length > 0 && <Card>
      <CardHeader>
        <CardTitle>Create custom template</CardTitle>
        <CardDescription>Define the stable fields you want extracted, and the file the worksheet belongs to.</CardDescription>
      </CardHeader>
      <CardContent><TemplateForm workspaceId={workspaceId} files={files.map((file) => ({ id: file.id, name: file.name }))} /></CardContent>
    </Card>}
  </main>
}
