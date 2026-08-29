"use client"

/** Shown on a bank_statement or supplier_statement document view (the caller enforces that — see
 * the document page). One row per suggested/decided BankMatch, kind-aware labels so the same panel
 * serves both WP2.1 (bank) and WP2.3 (supplier_statement) reconciliation. */

import { decideBankMatchAction, regenerateBankMatchesAction, regenerateSupplierStatementMatchesAction } from "@/app/(app)/workspaces/[workspaceId]/bank-match-actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"

export type BankMatchRow = {
  id: string
  transactionIndex: number
  kind: string
  confidence: number
  dateDeltaDays: number | null
  status: string
  matchedDocument: { id: string; filename: string }
}

const KIND_LABELS: Record<string, { title: string; rowNoun: string }> = {
  bank: { title: "Bank matches", rowNoun: "transaction" },
  supplier_statement: { title: "Supplier statement matches", rowNoun: "entry" },
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  const tone = confidence >= 0.85 ? "text-emerald-700 bg-emerald-100" : confidence >= 0.7 ? "text-amber-700 bg-amber-100" : "text-stone-600 bg-stone-100"
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{pct}%</span>
}

export function MatchPanel({ workspaceId, statementDocumentId, kind, matches }: { workspaceId: string; statementDocumentId: string; kind: "bank" | "supplier_statement"; matches: BankMatchRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const labels = KIND_LABELS[kind]

  const decide = (matchId: string, status: "accepted" | "rejected") => startTransition(async () => {
    const res = await decideBankMatchAction(workspaceId, matchId, status)
    if (res.success) router.refresh()
    else toast.error(res.error || "Could not update that match")
  })

  const regenerate = () => startTransition(async () => {
    const res = kind === "bank"
      ? await regenerateBankMatchesAction(workspaceId, statementDocumentId)
      : await regenerateSupplierStatementMatchesAction(workspaceId, statementDocumentId)
    if (res.success) { toast.success("Matches regenerated"); router.refresh() }
    else toast.error(res.error || "Could not regenerate matches")
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{labels.title}</CardTitle>
          <CardDescription>Accept a match to confirm it, or reject it if this {labels.rowNoun} doesn&apos;t belong to that document.</CardDescription>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={regenerate}>Re-scan</Button>
      </CardHeader>
      <CardContent>
        {!matches.length
          ? <p className="text-sm text-stone-500">No matches yet.</p>
          : <ul className="divide-y">
              {matches.map((match) => (
                <li key={match.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">#{match.transactionIndex + 1}</span>{" "}
                    <span className="text-stone-600">→ {match.matchedDocument.filename}</span>
                    {match.dateDeltaDays !== null && <span className="ml-2 text-xs text-stone-500">{Math.round(match.dateDeltaDays)}d apart</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <ConfidenceBadge confidence={match.confidence} />
                    {match.status === "suggested" ? (
                      <>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide(match.id, "accepted")}>Accept</Button>
                        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => decide(match.id, "rejected")}>Reject</Button>
                      </>
                    ) : (
                      <span className={`text-xs font-medium ${match.status === "accepted" ? "text-emerald-700" : "text-stone-500"}`}>{match.status}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>}
      </CardContent>
    </Card>
  )
}
