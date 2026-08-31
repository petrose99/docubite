"use client"

import { Button } from "@/components/ui/button"
import * as Sentry from "@sentry/nextjs"
import { AlertTriangle } from "lucide-react"
import Link from "next/link"
import { useEffect } from "react"

/** Nearest boundary for the sheet, documents, and settings pages, so a failed query shows a
 * recoverable message inside the app shell instead of the full-page global error. */
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error) }, [error])

  return <main className="flex flex-1 items-center justify-center p-8">
    <div className="max-w-md space-y-4 text-center">
      <AlertTriangle className="mx-auto h-12 w-12 text-indigo-600" />
      <h1 className="text-2xl font-bold text-slate-900">This page could not be loaded</h1>
      <p className="text-sm text-slate-500">Something went wrong on our side. Your documents are safe — try again, and if it keeps happening, reload the page.</p>
      {error.digest && <p className="font-mono text-xs text-slate-400">Reference: {error.digest}</p>}
      <div className="flex justify-center gap-2 pt-2">
        <Button type="button" onClick={reset}>Try again</Button>
        <Button asChild variant="outline"><Link href="/workspaces">Back to workspaces</Link></Button>
      </div>
    </div>
  </main>
}
