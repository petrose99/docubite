import { saveDocumentReviewAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DeleteDocumentButton } from "@/components/documents/delete-document-button"
import { LineItemsEditor } from "@/components/documents/line-items-editor"
import { PushToAccountingCard } from "@/components/documents/push-to-accounting-card"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { parseTemplateFields } from "@/lib/document-templates"
import { getWorkspaceDocument } from "@/models/documents"
import { listWorkspaceIntegrationConnections, listWorkspaceIntegrationPushes, workspaceIntegrationsPlanEnabled } from "@/models/integrations"
import { requireWorkspaceRole } from "@/models/workspaces"
import Link from "next/link"
import { notFound } from "next/navigation"

const LOW_CONFIDENCE_THRESHOLD = 0.6
const PUSHABLE_TEMPLATE_CODES = new Set(["invoice", "receipt"])

export default async function DocumentPage({ params }: { params: Promise<{ workspaceId: string; documentId: string }> }) {
  const { workspaceId, documentId } = await params
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)
  const document = await getWorkspaceDocument(workspaceId, documentId)
  if (!document) notFound()

  // Accounting push affordance: only for a reviewed invoice/receipt, and only when the deployment
  // and plan both allow integrations at all — cheap checks first so the two extra queries below
  // are skipped for the common case (a document that never qualifies).
  const canPush = document.status === "reviewed" && PUSHABLE_TEMPLATE_CODES.has(document.template?.code ?? "")
    && config.integrations.enabled && (await workspaceIntegrationsPlanEnabled(workspaceId))
  const [connections, pushes] = canPush
    ? await Promise.all([listWorkspaceIntegrationConnections(workspaceId), listWorkspaceIntegrationPushes(workspaceId, documentId)])
    : [[], []]

  const fields = parseTemplateFields(document.fieldSnapshot)
  const confidence = document.confidence as { missingRequiredFields?: string[]; fieldConfidence?: Record<string, number>; conflictingFields?: string[] } | null
  const fieldConfidence = confidence?.fieldConfidence || {}
  const conflictingLabels = (confidence?.conflictingFields || []).map((key) => fields.find((field) => field.key === key)?.label || key)
  const data = (document.reviewedData || document.rawExtraction || {}) as Record<string, unknown>
  const saveReview = async (formData: FormData) => { "use server"; await saveDocumentReviewAction(workspaceId, documentId, formData) }

  return <main className="mx-auto max-w-3xl space-y-6">
    <Link className="text-sm underline" href={`/workspaces/${workspaceId}/files/${document.fileId}/sheet`}>Back to sheet</Link>
    <header><div className="flex items-start justify-between gap-4"><h1 className="text-3xl font-bold">{document.filename}</h1><DeleteDocumentButton workspaceId={workspaceId} fileId={document.fileId} documentId={document.id} filename={document.filename} /></div><div className="mt-2 flex gap-2"><Badge>{document.status.replaceAll("_", " ")}</Badge>{document.storageKey && <a className="text-sm underline" href={`/api/documents/${document.id}/source`}>View source</a>}</div>{confidence?.missingRequiredFields?.length ? <p className="mt-3 text-sm text-amber-700">Missing required fields: {confidence.missingRequiredFields.join(", ")}</p> : null}{conflictingLabels.length ? <p className="mt-1 text-sm text-amber-700">Pages of this document disagreed on: {conflictingLabels.join(", ")} — please confirm against the source.</p> : null}</header>
    <Card><CardHeader><CardTitle>Review extracted data</CardTitle><CardDescription>Your saved values are separate from the original AI extraction. Fields highlighted in amber had low AI confidence.</CardDescription></CardHeader><CardContent><form action={saveReview} className="space-y-4">{fields.map((field) => {
      const lowConfidence = typeof fieldConfidence[field.key] === "number" && fieldConfidence[field.key] < LOW_CONFIDENCE_THRESHOLD
      return <div key={field.key} className={`space-y-1 rounded-md ${lowConfidence ? "border border-amber-300 bg-amber-50 p-2" : ""}`}>
        <Label htmlFor={field.key}>{field.label}{field.required ? " *" : ""}{lowConfidence ? <span className="ml-2 text-xs font-normal text-amber-700">Low confidence</span> : null}</Label>
        {field.type === "boolean" ? (
          <label className="flex items-center gap-2 text-sm"><input id={field.key} name={field.key} type="checkbox" value="true" defaultChecked={data[field.key] === true} />Yes</label>
        ) : field.type === "enum" ? (
          <select id={field.key} name={field.key} defaultValue={typeof data[field.key] === "string" ? String(data[field.key]) : ""} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="">Select a value</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select>
        ) : field.type === "array" ? (
          field.itemFields?.length
            ? <LineItemsEditor fieldKey={field.key} itemFields={field.itemFields} initialRows={Array.isArray(data[field.key]) ? data[field.key] as Array<Record<string, unknown>> : []} />
            : <textarea id={field.key} name={field.key} defaultValue={Array.isArray(data[field.key]) ? JSON.stringify(data[field.key]) : ""} placeholder="JSON array" className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm" />
        ) : (
          <Input id={field.key} name={field.key} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} defaultValue={typeof data[field.key] === "string" || typeof data[field.key] === "number" ? String(data[field.key]) : ""} />
        )}
      </div>
    })}<Button type="submit">Save review</Button></form></CardContent></Card>
    {canPush && (
      <PushToAccountingCard
        workspaceId={workspaceId}
        documentId={documentId}
        connections={connections}
        pushes={pushes}
      />
    )}
  </main>
}
