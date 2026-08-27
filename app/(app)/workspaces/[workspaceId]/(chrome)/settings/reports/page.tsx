import { ReportTemplateForm } from "@/components/dictation/report-template-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { parseNarrativeSections } from "@/lib/report-render/narrative"
import { parseSynopticFields } from "@/lib/report-render/synoptic"
import { ensureWorkspaceReportTemplates, listReportTemplates } from "@/models/report-templates"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

/** Report templates: the format a dictation is drafted into.
 *
 * Distinct from Document templates, which say what to extract. This says what the report says and
 * in what order — which slots the synoptic block has, which of them are required (and therefore
 * raised by the pre-sign-off checklist), and which prose sections follow. */
export default async function ReportTemplatesPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  if (!config.asr.enabled || membership.workspace.productMode !== "clinical") notFound()
  await ensureWorkspaceReportTemplates(workspaceId)
  const templates = await listReportTemplates(workspaceId)

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Report templates</h1>
      <p className="mt-1 text-muted-foreground">
        The format a dictation is drafted into. Rendering walks these slots, never the extracted values, so a
        value the template does not name can never reach a report.
      </p>
    </header>

    {templates.map((template) => <Card key={template.id}>
      <CardHeader>
        <CardTitle>{template.name}</CardTitle>
        <CardDescription>
          {template.specimenType ? `Used for ${template.specimenType} specimens.` : "The workspace fallback, used when no template matches the dictated specimen type."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {membership.role === "owner"
          ? <ReportTemplateForm
              workspaceId={workspaceId}
              templateId={template.id}
              synopticFields={parseSynopticFields(template.synopticFields)}
              narrativeSections={parseNarrativeSections(template.narrativeSections)} />
          : <ReadOnlyTemplate
              synopticFields={parseSynopticFields(template.synopticFields)}
              narrativeSections={parseNarrativeSections(template.narrativeSections)} />}
      </CardContent>
    </Card>)}
  </main>
}

function ReadOnlyTemplate({ synopticFields, narrativeSections }: {
  synopticFields: { key: string; label: string; required: boolean }[]
  narrativeSections: { key: string; title: string }[]
}) {
  return <div className="space-y-4 text-sm">
    <div>
      <p className="font-medium">Synoptic slots</p>
      <ul className="mt-1 space-y-1">
        {synopticFields.map((field) => <li key={field.key} className="flex items-center justify-between gap-3 rounded border px-3 py-1.5">
          <span>{field.label}</span>
          <span className="text-xs text-muted-foreground">{field.required ? "required" : "optional"}</span>
        </li>)}
      </ul>
    </div>
    <div>
      <p className="font-medium">Narrative sections</p>
      <ul className="mt-1 space-y-1">
        {narrativeSections.map((section) => <li key={section.key} className="rounded border px-3 py-1.5">{section.title}</li>)}
      </ul>
    </div>
    <p className="text-xs text-muted-foreground">Only a workspace owner can change these.</p>
  </div>
}
