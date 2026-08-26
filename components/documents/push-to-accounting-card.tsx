"use client"

/** Shown only on a reviewed invoice/receipt document (the caller enforces that — see the document
 * page). One button per connected + fully-configured (default account set) accounting provider;
 * pushing is inline and awaited, so the card shows the outcome immediately. A push that ends up
 * failed offers Retry, which is the same action re-run — a push row is upserted per
 * (document, connection), so retrying never creates a duplicate bill. */

import { pushDocumentToAccountingAction } from "@/app/(app)/workspaces/[workspaceId]/integration-push-actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"

const PROVIDER_LABELS: Record<string, string> = { quickbooks: "QuickBooks", xero: "Xero" }

export type PushableConnection = {
  id: string
  provider: string
  tenantName: string | null
  status: string
  defaultExpenseAccountId: string | null
}

export type DocumentPush = {
  id: string
  connectionId: string
  status: string
  attempts: number
  externalBillId: string | null
  errorCode: string | null
}

function StatusLabel({ push }: { push: DocumentPush | undefined }) {
  if (!push) return null
  if (push.status === "succeeded") return <span className="text-xs text-emerald-700">Pushed{push.externalBillId ? ` — ${push.externalBillId}` : ""}</span>
  if (push.status === "failed") return <span className="text-xs text-red-600">Failed{push.errorCode ? ` (${push.errorCode.replaceAll("_", " ")})` : ""}</span>
  return <span className="text-xs text-amber-700">Pending</span>
}

export function PushToAccountingCard({ workspaceId, documentId, connections, pushes }: {
  workspaceId: string
  documentId: string
  connections: PushableConnection[]
  pushes: DocumentPush[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const pushable = connections.filter((c) => c.status === "active" && c.defaultExpenseAccountId)
  if (!pushable.length) return null

  const pushByConnection = new Map(pushes.map((p) => [p.connectionId, p]))

  const push = (connectionId: string) => startTransition(async () => {
    const res = await pushDocumentToAccountingAction(workspaceId, documentId, connectionId)
    if (res.success) {
      toast.success(res.data?.status === "succeeded" ? "Pushed to accounting" : "Push queued")
      router.refresh()
    } else {
      toast.error(res.error || "Could not push this document")
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push to accounting</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {pushable.map((connection) => {
          const existing = pushByConnection.get(connection.id)
          const label = PROVIDER_LABELS[connection.provider] ?? connection.provider
          return (
            <span key={connection.id} className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => push(connection.id)}>
                {existing?.status === "failed" ? `Retry ${label}` : `Push to ${label}`}
              </Button>
              <StatusLabel push={existing} />
            </span>
          )
        })}
      </CardContent>
    </Card>
  )
}
