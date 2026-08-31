"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  createApiKeyAction,
  createWebhookEndpointAction,
  deleteWebhookEndpointAction,
  redeliverDeliveryAction,
  revokeApiKeyAction,
  setWebhookEndpointStatusAction,
} from "@/app/(app)/workspaces/[workspaceId]/integrations-actions"
import {
  disconnectIntegrationAction,
  listExpenseAccountsAction,
  setDefaultExpenseAccountAction,
  syncAccountingEntitiesAction,
} from "@/app/(app)/workspaces/[workspaceId]/integration-connection-actions"
import { Check, Copy } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

type ApiKey = { id: string; name: string; keyPrefix: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }
type Endpoint = { id: string; url: string; events: string[]; status: string; failureCount: number; createdAt: Date }
type Delivery = { id: string; endpointId: string; eventType: string; status: string; attempts: number; responseStatus: number | null; errorCode: string | null; deliveredAt: Date | null; createdAt: Date }
type IntegrationConnection = {
  id: string
  provider: string
  externalTenantId: string | null
  tenantName: string | null
  status: string
  defaultExpenseAccountId: string | null
  defaultExpenseAccountName: string | null
  createdAt: Date
  lastSyncedAt: Date | null
}

const PROVIDER_LABELS: Record<string, string> = { quickbooks: "QuickBooks", xero: "Xero" }

/** One connected-provider card: shows tenant/status, a default-expense-account picker (fetched live
 * from the provider on demand — the chart of accounts isn't cached), and Disconnect. */
function AccountingConnectionCard({ workspaceId, connection, isOwner, onChanged }: {
  workspaceId: string
  connection: IntegrationConnection
  isOwner: boolean
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [accounts, setAccounts] = useState<{ id: string; name: string }[] | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)

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
    <li className="rounded border px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="font-medium">{PROVIDER_LABELS[connection.provider] ?? connection.provider}</span>{" "}
          <span className="text-xs text-muted-foreground">{connection.tenantName || connection.externalTenantId}</span>
          {connection.status === "needs_reauth" && <span className="ml-2 text-xs text-red-600">needs reconnect</span>}
        </span>
        {isOwner && connection.status === "active" && (
          <Button type="button" size="sm" variant="ghost" disabled={pending}
            onClick={() => startTransition(async () => {
              const res = await syncAccountingEntitiesAction(workspaceId, connection.id)
              if (res.success) onChanged()
              else toast.error(res.error || "Could not sync accounts")
            })}>
            Sync accounts
          </Button>
        )}
        {isOwner && (
          <Button type="button" size="sm" variant="ghost" disabled={pending}
            onClick={() => { if (confirm(`Disconnect ${PROVIDER_LABELS[connection.provider] ?? connection.provider}? Pushes to it will stop.`)) startTransition(async () => {
              const res = await disconnectIntegrationAction(workspaceId, connection.id)
              if (res.success) onChanged()
              else toast.error(res.error || "Could not disconnect")
            }) }}>
            Disconnect
          </Button>
        )}
      </div>
      {isOwner && connection.status === "active" && (
        <p className="mt-1 text-xs text-muted-foreground">
          {connection.lastSyncedAt ? `Accounts last synced ${connection.lastSyncedAt.toLocaleString()}` : "Accounts not yet synced"}
        </p>
      )}
      {isOwner && connection.status === "active" && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <Label htmlFor={`account-${connection.id}`} className="shrink-0 text-muted-foreground">Default expense account</Label>
          {accounts === null ? (
            <Button type="button" size="sm" variant="outline" disabled={loadingAccounts} onClick={loadAccounts}>
              {connection.defaultExpenseAccountName || (loadingAccounts ? "Loading…" : "Choose account")}
            </Button>
          ) : (
            <select
              id={`account-${connection.id}`}
              className="rounded border px-2 py-1 text-xs"
              defaultValue={connection.defaultExpenseAccountId ?? ""}
              disabled={pending}
              onChange={(e) => onSelectAccount(e.target.value)}
            >
              <option value="" disabled>Select an account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
      )}
    </li>
  )
}

/** The one place a freshly-minted secret is shown. Once dismissed it is gone: we only stored the
 * hash / ciphertext, so there is no way to show it again — which the copy affordance makes plain. */
function SecretReveal({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy — select and copy manually")
    }
  }
  return (
    <div className="rounded-md border border-indigo-300 bg-indigo-50 p-3">
      <p className="text-sm font-medium text-indigo-900">{label}</p>
      <p className="mt-1 text-xs text-indigo-800">Copy it now — it won&apos;t be shown again.</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="block flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{value}</code>
        <Button type="button" size="icon" variant="outline" onClick={copy} aria-label="Copy">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={onDone}>Done</Button>
    </div>
  )
}

export function IntegrationsManager({
  workspaceId, isOwner, eventTypes, apiKeys, endpoints, deliveries, accountingProviders, connections,
}: {
  workspaceId: string
  isOwner: boolean
  eventTypes: string[]
  apiKeys: ApiKey[]
  endpoints: Endpoint[]
  deliveries: Delivery[]
  accountingProviders: { quickbooks: boolean; xero: boolean }
  connections: IntegrationConnection[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [keyName, setKeyName] = useState("")
  const [freshKey, setFreshKey] = useState<string | null>(null)
  const [url, setUrl] = useState("")
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [freshSecret, setFreshSecret] = useState<string | null>(null)

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, onOk?: () => void) =>
    startTransition(async () => {
      const res = await fn()
      if (res.success) { onOk?.(); router.refresh() }
      else toast.error(res.error || "Something went wrong")
    })

  const toggleEvent = (type: string) =>
    setSelectedEvents((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))

  const connectionsByProvider = new Map(connections.map((c) => [c.provider, c]))
  const anyProviderConfigured = accountingProviders.quickbooks || accountingProviders.xero

  return (
    <div className="space-y-6">
      {/* Accounting connectors (P2) — omitted entirely if neither provider is configured on this deployment. */}
      {anyProviderConfigured && (
        <Card>
          <CardHeader>
            <CardTitle>Accounting</CardTitle>
            <CardDescription>Connect QuickBooks or Xero to push a reviewed invoice or receipt as a bill.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {(["quickbooks", "xero"] as const)
                .filter((provider) => accountingProviders[provider])
                .map((provider) => {
                  const connection = connectionsByProvider.get(provider)
                  if (connection) {
                    return (
                      <AccountingConnectionCard
                        key={provider}
                        workspaceId={workspaceId}
                        connection={connection}
                        isOwner={isOwner}
                        onChanged={() => router.refresh()}
                      />
                    )
                  }
                  return (
                    <li key={provider} className="flex items-center justify-between rounded border px-3 py-2">
                      <span className="font-medium">{PROVIDER_LABELS[provider]}</span>
                      {isOwner ? (
                        <a
                          className="text-sm font-medium text-emerald-700 hover:underline"
                          href={`/api/integrations/${provider}/connect?workspaceId=${workspaceId}`}
                        >
                          Connect
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not connected</span>
                      )}
                    </li>
                  )
                })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* API keys */}
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>Authenticate requests to the DocuBite API (<code className="font-mono text-xs">/api/v1</code>). Send the key as <code className="font-mono text-xs">Authorization: Bearer …</code>.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {freshKey && <SecretReveal label="Your new API key" value={freshKey} onDone={() => setFreshKey(null)} />}
          {isOwner && (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                run(() => createApiKeyAction(workspaceId, keyName), () => setKeyName(""))
              }}
            >
              <div className="flex-1">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Zapier" />
              </div>
              <Button type="submit" disabled={pending}>Create key</Button>
            </form>
          )}
          <ul className="space-y-1 text-sm">
            {apiKeys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-3 rounded border px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{key.name}</span>{" "}
                  <code className="font-mono text-xs text-muted-foreground">{key.keyPrefix}…</code>
                  {key.revokedAt && <span className="ml-2 text-xs text-red-600">revoked</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{key.lastUsedAt ? `used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "never used"}</span>
                  {isOwner && !key.revokedAt && (
                    <Button type="button" size="sm" variant="ghost" disabled={pending}
                      onClick={() => { if (confirm("Revoke this key? Requests using it will stop working immediately.")) run(() => revokeApiKeyAction(workspaceId, key.id)) }}>
                      Revoke
                    </Button>
                  )}
                </span>
              </li>
            ))}
            {!apiKeys.length && <li className="text-muted-foreground">No API keys yet.</li>}
          </ul>
        </CardContent>
      </Card>

      {/* Webhook endpoints */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook endpoints</CardTitle>
          <CardDescription>Receive a signed POST when documents change. Verify the <code className="font-mono text-xs">X-DocuBite-Signature</code> header with the signing secret.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {freshSecret && <SecretReveal label="Signing secret for this endpoint" value={freshSecret} onDone={() => setFreshSecret(null)} />}
          {isOwner && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                run(
                  () => createWebhookEndpointAction(workspaceId, url, selectedEvents),
                  () => { setUrl(""); setSelectedEvents([]) },
                )
              }}
            >
              <div>
                <Label htmlFor="endpoint-url">Endpoint URL (https)</Label>
                <Input id="endpoint-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.example.com/docubite" required />
              </div>
              <fieldset>
                <legend className="text-sm font-medium">Events <span className="font-normal text-muted-foreground">(none selected = all)</span></legend>
                <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {eventTypes.map((type) => (
                    <label key={type} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={selectedEvents.includes(type)} onChange={() => toggleEvent(type)} />
                      <span className="font-mono">{type}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" disabled={pending}>Add endpoint</Button>
            </form>
          )}
          <ul className="space-y-1 text-sm">
            {endpoints.map((endpoint) => (
              <li key={endpoint.id} className="flex items-center justify-between gap-3 rounded border px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs">{endpoint.url}</span>
                  <span className="text-xs text-muted-foreground">
                    {endpoint.events.length ? endpoint.events.join(", ") : "all events"}
                    {endpoint.status !== "active" && <span className="ml-2 text-red-600">disabled</span>}
                  </span>
                </span>
                {isOwner && (
                  <span className="flex items-center gap-1">
                    <Button type="button" size="sm" variant="ghost" disabled={pending}
                      onClick={() => run(() => setWebhookEndpointStatusAction(workspaceId, endpoint.id, endpoint.status === "active" ? "disabled" : "active"))}>
                      {endpoint.status === "active" ? "Disable" : "Enable"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={pending}
                      onClick={() => { if (confirm("Delete this endpoint?")) run(() => deleteWebhookEndpointAction(workspaceId, endpoint.id)) }}>
                      Delete
                    </Button>
                  </span>
                )}
              </li>
            ))}
            {!endpoints.length && <li className="text-muted-foreground">No webhook endpoints yet.</li>}
          </ul>
        </CardContent>
      </Card>

      {/* Recent deliveries */}
      <Card>
        <CardHeader>
          <CardTitle>Recent deliveries</CardTitle>
          <CardDescription>The last {deliveries.length} delivery attempts. Failed deliveries retry automatically; you can also redeliver.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Response</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">{d.eventType}</td>
                    <td className="py-2 pr-3">
                      <span className={d.status === "delivered" ? "text-emerald-700" : d.status === "failed" ? "text-red-600" : "text-indigo-700"}>{d.status}</span>
                      {d.attempts > 1 && <span className="text-xs text-muted-foreground"> ·{d.attempts}×</span>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{d.responseStatus ?? d.errorCode ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</td>
                    <td className="py-2 text-right">
                      {isOwner && d.status !== "delivered" && (
                        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => redeliverDeliveryAction(workspaceId, d.id))}>Redeliver</Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!deliveries.length && (
                  <tr><td colSpan={5} className="py-3 text-muted-foreground">No deliveries yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
