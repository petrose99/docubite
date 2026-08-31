"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { repairBigcapitalConnectionAction } from "@/app/(app)/workspaces/[workspaceId]/accounting-actions"
import {
  listExpenseAccountsAction,
  setDefaultExpenseAccountAction,
  syncAccountingEntitiesAction,
} from "@/app/(app)/workspaces/[workspaceId]/integration-connection-actions"
import {
  pushAllReadyDocumentsAction,
  pushDocumentToAccountingAction,
} from "@/app/(app)/workspaces/[workspaceId]/integration-push-actions"
import type { ReadyToPushDocument } from "@/models/documents"
import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

type Connection = {
  id: string
  externalTenantId: string | null
  tenantName: string | null
  status: string
  defaultExpenseAccountId: string | null
  defaultExpenseAccountName: string | null
  createdAt: Date
} | null

type ProvisionJob = { status: string; attempts: number; errorCode: string | null; nextAttemptAt: Date; updatedAt: Date } | null

const STATUS_LABEL: Record<string, string> = {
  active: "Connected",
  needs_reauth: "Needs reconnect",
  error: "Error",
  provisioning: "Provisioning…",
  not_started: "Not started",
}

/** Derives the card's display status from the connection + job pair. Explicitly covers "neither
 * exists yet" (not_started) as its own state — a workspace whose provisioning was never enqueued,
 * or whose enqueue silently failed (see models/workspaces.ts) — rather than lumping it into
 * "provisioning" with no job actually in flight and no way to start one. Only a `pending` job with
 * no connection is genuinely "in flight" — a `succeeded` job with no connection means the
 * connection was disconnected afterward (disconnectIntegrationAction doesn't touch the job row),
 * which needs the same repair affordance as a real failure, not a permanent spinner. */
function deriveStatus(connection: Connection, job: ProvisionJob): string {
  if (connection) return connection.status
  if (job?.status === "pending") return "provisioning"
  return job ? "error" : "not_started"
}

/** The connection status card: shows where this workspace's Bigcapital organization stands — being
 * built, live, or stuck — and the one action available either way (repair/re-provision), since
 * there is no manual "Connect" step to offer for an auto-provisioned tenant. */
function ConnectionCard({ workspaceId, isOwner, apiBase, connection, job, onChanged }: {
  workspaceId: string
  isOwner: boolean
  apiBase: string
  connection: Connection
  job: ProvisionJob
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()

  const repair = () => startTransition(async () => {
    const res = await repairBigcapitalConnectionAction(workspaceId)
    if (res.success) { toast.success("Provisioning started"); onChanged() }
    else toast.error(res.error || "Could not start provisioning")
  })

  const status = deriveStatus(connection, job)
  const isProvisioning = status === "provisioning"
  // Every status except "active" and "provisioning" (still in flight, nothing to repair yet) gets
  // the repair/start button — including "not_started", so a workspace whose job never got enqueued
  // isn't left showing a permanent spinner with no way out.
  const needsRepair = status === "needs_reauth" || status === "error" || status === "not_started"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection</CardTitle>
        <CardDescription>Every workspace gets its own isolated Bigcapital organization, created automatically — nothing to connect by hand.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">
              {connection?.tenantName || "Your organization"}
              <span className={`ml-2 text-xs ${status === "active" ? "text-emerald-700" : needsRepair ? "text-red-600" : "text-muted-foreground"}`}>
                {isProvisioning && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                {STATUS_LABEL[status] ?? status}
              </span>
            </p>
            {job?.errorCode && status !== "active" && <p className="mt-1 text-xs text-muted-foreground">Last error: {job.errorCode.replaceAll("_", " ")}</p>}
          </div>
          {isOwner && connection?.status === "active" && connection.externalTenantId && (
            <a className="shrink-0 text-sm font-medium text-emerald-700 hover:underline" href={`${apiBase}`} target="_blank" rel="noreferrer">
              Open in Bigcapital
            </a>
          )}
          {isOwner && needsRepair && (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={repair}>
              {pending ? "Starting…" : status === "not_started" ? "Start provisioning" : "Repair connection"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** Chart-of-accounts + vendor counts, a manual "Sync now", and the default expense account every
 * pushed bill will be coded to — the same picker AccountingConnectionCard in integrations-manager.tsx
 * uses, reused here rather than duplicated. */
function SyncCard({ workspaceId, connection, lastSyncedAt, entityCounts, onChanged }: {
  workspaceId: string
  connection: NonNullable<Connection>
  lastSyncedAt: Date | null
  entityCounts: { accounts: number; vendors: number }
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [accounts, setAccounts] = useState<{ id: string; name: string }[] | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  const sync = () => startTransition(async () => {
    const res = await syncAccountingEntitiesAction(workspaceId, connection.id)
    if (res.success) { toast.success("Synced"); onChanged() }
    else toast.error(res.error || "Could not sync accounts")
  })

  const loadAccounts = () => {
    setLoadingAccounts(true)
    startTransition(async () => {
      const res = await listExpenseAccountsAction(workspaceId, connection.id)
      setLoadingAccounts(false)
      if (res.success) setAccounts(res.data ?? [])
      else toast.error(res.error || "Could not load expense accounts")
    })
  }

  const onSelectAccount = (accountId: string) => {
    const account = accounts?.find((a) => a.id === accountId)
    if (!account) return
    startTransition(async () => {
      const res = await setDefaultExpenseAccountAction(workspaceId, connection.id, account.id, account.name)
      if (res.success) onChanged()
      else toast.error(res.error || "Could not set the default account")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync &amp; coding</CardTitle>
        <CardDescription>Pull the chart of accounts and vendor list so documents can be coded to a real ledger account before they push.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {entityCounts.accounts} account{entityCounts.accounts === 1 ? "" : "s"}, {entityCounts.vendors} vendor{entityCounts.vendors === 1 ? "" : "s"}
            {" — "}{lastSyncedAt ? `last synced ${lastSyncedAt.toLocaleString()}` : "not yet synced"}
          </span>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={sync}>Sync now</Button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="default-expense-account" className="shrink-0 text-muted-foreground">Default expense account</Label>
          {accounts === null ? (
            <Button type="button" size="sm" variant="outline" disabled={loadingAccounts} onClick={loadAccounts}>
              {connection.defaultExpenseAccountName || (loadingAccounts ? "Loading…" : "Choose account")}
            </Button>
          ) : (
            <select
              id="default-expense-account"
              className="rounded border px-2 py-1 text-sm"
              defaultValue={connection.defaultExpenseAccountId ?? ""}
              disabled={pending}
              onChange={(e) => onSelectAccount(e.target.value)}
            >
              <option value="" disabled>Select an account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** Formats a bill total using the document's own currency when it has one, falling back to a plain
 * number — a document without a recognized 3-letter currency code (normalizeBillFromDocument's
 * currencyCode) still needs a readable amount rather than a thrown Intl error. */
function formatAmount(total: number, currencyCode: string | null): string {
  if (currencyCode) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(total)
    } catch {
      // fall through to plain formatting on an unrecognized code
    }
  }
  return total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** The canvas's "Ready to push · N" batch surface: a row per reviewed, pushable document with a
 * per-row Push button, plus a header Push all that runs the same push server-side for the whole
 * set. Only rendered once the connection is itself pushable (active + default account chosen) —
 * the caller (AccountingDashboard) gates on that the same way PushToAccountingCard does per document. */
function ReadyToPushList({ workspaceId, connectionId, documents, onChanged }: {
  workspaceId: string
  connectionId: string
  documents: ReadyToPushDocument[]
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [pushingId, setPushingId] = useState<string | null>(null)

  const pushOne = (documentId: string) => {
    setPushingId(documentId)
    startTransition(async () => {
      const res = await pushDocumentToAccountingAction(workspaceId, documentId, connectionId)
      setPushingId(null)
      if (res.success) { toast.success(res.data?.status === "succeeded" ? "Pushed to accounting" : "Push queued"); onChanged() }
      else toast.error(res.error || "Could not push this document")
    })
  }

  const pushAll = () => startTransition(async () => {
    const res = await pushAllReadyDocumentsAction(workspaceId, connectionId)
    if (res.success) {
      const { pushed, failed } = res.data ?? { pushed: 0, failed: 0 }
      if (failed) toast.warning(`Pushed ${pushed}, ${failed} failed`)
      else toast.success(`Pushed ${pushed} document${pushed === 1 ? "" : "s"}`)
      onChanged()
    } else {
      toast.error(res.error || "Could not push documents")
    }
  })

  if (!documents.length) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Ready to push · {documents.length}</CardTitle>
        <Button type="button" size="sm" disabled={pending} onClick={pushAll}>
          {pending && !pushingId ? "Pushing…" : "Push all"}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Supplier</th>
                <th className="px-4 py-2 font-medium">Document</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">{doc.vendorName}</td>
                  <td className="px-4 py-2 text-muted-foreground">{doc.filename}</td>
                  <td className="px-4 py-2 tabular-nums">{formatAmount(doc.total, doc.currencyCode)}</td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-emerald-700 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                      disabled={pending}
                      onClick={() => pushOne(doc.id)}
                    >
                      {pushingId === doc.id ? "Pushing…" : "Push"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export function AccountingDashboard({ workspaceId, isOwner, apiBase, connection, job, lastSyncedAt, entityCounts, readyToPush }: {
  workspaceId: string
  isOwner: boolean
  apiBase: string
  connection: Connection
  job: ProvisionJob
  lastSyncedAt: Date | null
  entityCounts: { accounts: number; vendors: number }
  readyToPush: ReadyToPushDocument[]
}) {
  const router = useRouter()
  const onChanged = () => router.refresh()

  const pushable = connection?.status === "active" && !!connection.defaultExpenseAccountId

  return (
    <div className="space-y-6">
      <ConnectionCard workspaceId={workspaceId} isOwner={isOwner} apiBase={apiBase} connection={connection} job={job} onChanged={onChanged} />
      {connection?.status === "active" && (
        <SyncCard workspaceId={workspaceId} connection={connection} lastSyncedAt={lastSyncedAt} entityCounts={entityCounts} onChanged={onChanged} />
      )}
      {pushable && connection && (
        <ReadyToPushList workspaceId={workspaceId} connectionId={connection.id} documents={readyToPush} onChanged={onChanged} />
      )}
    </div>
  )
}
