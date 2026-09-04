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
import { ArrowUpRight, CheckCircle2, CircleDot, FileText, Loader2, RefreshCw, ShieldAlert, Wallet } from "lucide-react"
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

function ConnectionCard({ workspaceId, isOwner, connection, job, lastSyncedAt, entityCounts, onChanged }: {
  workspaceId: string
  isOwner: boolean
  connection: Connection
  job: ProvisionJob
  lastSyncedAt: Date | null
  entityCounts: { accounts: number; vendors: number }
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [accounts, setAccounts] = useState<{ id: string; name: string }[] | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  const repair = () => startTransition(async () => {
    const res = await repairBigcapitalConnectionAction(workspaceId)
    if (res.success) { toast.success("Provisioning started"); onChanged() }
    else toast.error(res.error || "Could not start provisioning")
  })

  const sync = () => {
    if (!connection) return
    startTransition(async () => {
      const res = await syncAccountingEntitiesAction(workspaceId, connection.id)
      if (res.success) { toast.success("Synced"); onChanged() }
      else toast.error(res.error || "Could not sync accounts")
    })
  }

  const loadAccounts = () => {
    if (!connection) return
    setLoadingAccounts(true)
    startTransition(async () => {
      const res = await listExpenseAccountsAction(workspaceId, connection.id)
      setLoadingAccounts(false)
      if (res.success) setAccounts(res.data ?? [])
      else toast.error(res.error || "Could not load expense accounts")
    })
  }

  const onSelectAccount = (accountId: string) => {
    if (!connection) return
    const account = accounts?.find((a) => a.id === accountId)
    if (!account) return
    startTransition(async () => {
      const res = await setDefaultExpenseAccountAction(workspaceId, connection.id, account.id, account.name)
      if (res.success) onChanged()
      else toast.error(res.error || "Could not set the default account")
    })
  }

  const status = deriveStatus(connection, job)
  const needsRepair = status === "needs_reauth" || status === "error" || status === "not_started"
  const isActive = status === "active"

  const statusIcon = isActive
    ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
    : needsRepair
      ? <ShieldAlert className="h-5 w-5 text-red-500" />
      : <Loader2 className="h-5 w-5 animate-spin text-slate-400" />

  return (
    <Card className="overflow-hidden">
      <div className={`h-1 ${isActive ? "bg-emerald-500" : needsRepair ? "bg-red-400" : "bg-slate-200"}`} />
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleDot className="h-4 w-4 text-slate-400" />
          Connection
        </CardTitle>
        <CardDescription>Every workspace gets its own isolated accounting organization, created automatically — nothing to connect by hand.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
            {statusIcon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">{connection?.tenantName || "Your organization"}</p>
            <p className={`mt-0.5 text-xs font-medium ${isActive ? "text-emerald-600" : needsRepair ? "text-red-600" : "text-slate-400"}`}>
              {STATUS_LABEL[status] ?? status}
            </p>
            {job?.errorCode && !isActive && <p className="mt-0.5 text-xs text-slate-400">Last error: {job.errorCode.replaceAll("_", " ")}</p>}
          </div>
          {isOwner && needsRepair && (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={repair} className="shrink-0">
              {pending ? "Starting…" : status === "not_started" ? "Start provisioning" : "Repair connection"}
            </Button>
          )}
        </div>

        {isActive && connection && (
          <>
            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center gap-4 rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3">
                <div className="flex flex-1 items-center gap-6">
                  <div className="text-center">
                    <p className="text-lg font-bold tabular-nums text-slate-800">{entityCounts.accounts}</p>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Accounts</p>
                  </div>
                  <div className="h-8 w-px bg-slate-200" />
                  <div className="text-center">
                    <p className="text-lg font-bold tabular-nums text-slate-800">{entityCounts.vendors}</p>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Vendors</p>
                  </div>
                  <span className="ml-auto text-xs text-slate-400" suppressHydrationWarning>
                    {lastSyncedAt ? `Last synced ${lastSyncedAt.toLocaleDateString()}, ${lastSyncedAt.toLocaleTimeString()}` : "Not yet synced"}
                  </span>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={sync} className="shrink-0 gap-1.5">
                  <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
                  Sync now
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-slate-100 px-4 py-3">
              <Wallet className="h-4 w-4 shrink-0 text-slate-400" />
              <Label htmlFor="default-expense-account" className="shrink-0 text-sm text-slate-600">Default expense account</Label>
              {accounts === null ? (
                <Button type="button" size="sm" variant="outline" disabled={loadingAccounts} onClick={loadAccounts} className="ml-auto">
                  {connection.defaultExpenseAccountName || (loadingAccounts ? "Loading…" : "Choose account")}
                </Button>
              ) : (
                <select
                  id="default-expense-account"
                  className="ml-auto rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-emerald-400"
                  defaultValue={connection.defaultExpenseAccountId ?? ""}
                  disabled={pending}
                  onChange={(e) => onSelectAccount(e.target.value)}
                >
                  <option value="" disabled>Select an account</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </div>
          </>
        )}
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
function ReadyToPushList({ workspaceId, connectionId, documents, defaultAccountId, defaultAccountName, categoryAccountMap, onChanged }: {
  workspaceId: string
  connectionId: string
  documents: ReadyToPushDocument[]
  defaultAccountId: string
  defaultAccountName: string | null
  categoryAccountMap: Record<string, string>
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [pushingId, setPushingId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<{ id: string; name: string }[] | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [accountOverrides, setAccountOverrides] = useState<Record<string, string>>({})

  const loadAccounts = () => {
    setLoadingAccounts(true)
    startTransition(async () => {
      const res = await listExpenseAccountsAction(workspaceId, connectionId)
      setLoadingAccounts(false)
      if (res.success) setAccounts(res.data ?? [])
      else toast.error(res.error || "Could not load accounts")
    })
  }

  const setDocAccount = (documentId: string, accountId: string) => {
    setAccountOverrides((prev) => ({ ...prev, [documentId]: accountId }))
  }

  const resolveAccount = (doc: ReadyToPushDocument) =>
    categoryAccountMap[doc.category] ?? defaultAccountId

  const getDocAccount = (documentId: string, doc: ReadyToPushDocument) =>
    accountOverrides[documentId] ?? resolveAccount(doc)

  const pushOne = (doc: ReadyToPushDocument) => {
    setPushingId(doc.id)
    const accountId = getDocAccount(doc.id, doc)
    startTransition(async () => {
      const res = await pushDocumentToAccountingAction(workspaceId, doc.id, connectionId, accountId)
      setPushingId(null)
      if (res.success) { toast.success(res.data?.status === "succeeded" ? "Pushed to accounting" : "Push queued"); onChanged() }
      else toast.error(res.error || "Could not push this document")
    })
  }

  const pushAll = () => {
    const overrides: Record<string, string> = {}
    for (const doc of documents) {
      overrides[doc.id] = getDocAccount(doc.id, doc)
    }
    startTransition(async () => {
      const res = await pushAllReadyDocumentsAction(workspaceId, connectionId, overrides)
      if (res.success) {
        const { pushed, failed } = res.data ?? { pushed: 0, failed: 0 }
        if (failed) toast.warning(`Pushed ${pushed}, ${failed} failed`)
        else toast.success(`Pushed ${pushed} document${pushed === 1 ? "" : "s"}`)
        onChanged()
      } else {
        toast.error(res.error || "Could not push documents")
      }
    })
  }

  if (!documents.length) return null

  const accountLabel = (accountId: string) => {
    if (accounts) return accounts.find((a) => a.id === accountId)?.name ?? accountId
    return accountId === defaultAccountId ? (defaultAccountName ?? accountId) : accountId
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400" />
          <CardTitle>Ready to push</CardTitle>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-100 px-1.5 text-xs font-bold text-emerald-700">{documents.length}</span>
        </div>
        <Button type="button" size="sm" disabled={pending} onClick={pushAll} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
          <ArrowUpRight className="h-3.5 w-3.5" />
          {pending && !pushingId ? "Pushing…" : "Push all"}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-5 py-2.5 font-semibold">Supplier</th>
                <th className="px-5 py-2.5 font-semibold">Category</th>
                <th className="px-5 py-2.5 font-semibold text-right">Amount</th>
                <th className="px-5 py-2.5 font-semibold">Account</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{doc.vendorName}</p>
                    <p className="text-xs text-slate-400">{doc.filename}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{doc.category}</span>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-800">{formatAmount(doc.total, doc.currencyCode)}</td>
                  <td className="px-5 py-3">
                    {accounts === null ? (
                      <button
                        type="button"
                        onClick={loadAccounts}
                        disabled={loadingAccounts}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                      >
                        <Wallet className="h-3 w-3 text-slate-400" />
                        {accountLabel(getDocAccount(doc.id, doc))}
                      </button>
                    ) : (
                      <select
                        className="max-w-[160px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-emerald-400"
                        value={getDocAccount(doc.id, doc)}
                        onChange={(e) => setDocAccount(doc.id, e.target.value)}
                        disabled={pending}
                      >
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-emerald-200 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
                      disabled={pending}
                      onClick={() => pushOne(doc)}
                    >
                      {pushingId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><ArrowUpRight className="mr-1 h-3.5 w-3.5" />Push</>}
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

export function AccountingDashboard({ workspaceId, isOwner, apiBase, connection, job, lastSyncedAt, entityCounts, readyToPush, categoryAccountMap }: {
  workspaceId: string
  isOwner: boolean
  apiBase: string
  connection: Connection
  job: ProvisionJob
  lastSyncedAt: Date | null
  entityCounts: { accounts: number; vendors: number }
  readyToPush: ReadyToPushDocument[]
  categoryAccountMap: Record<string, string>
}) {
  const router = useRouter()
  const onChanged = () => router.refresh()

  const pushable = connection?.status === "active" && !!connection.defaultExpenseAccountId

  return (
    <div className="space-y-6">
      <ConnectionCard workspaceId={workspaceId} isOwner={isOwner} connection={connection} job={job} lastSyncedAt={lastSyncedAt} entityCounts={entityCounts} onChanged={onChanged} />
      {pushable && connection && connection.defaultExpenseAccountId && (
        <ReadyToPushList workspaceId={workspaceId} connectionId={connection.id} documents={readyToPush} defaultAccountId={connection.defaultExpenseAccountId} defaultAccountName={connection.defaultExpenseAccountName ?? null} categoryAccountMap={categoryAccountMap} onChanged={onChanged} />
      )}
    </div>
  )
}
