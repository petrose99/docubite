"use client"

import { AssistantPanel } from "@/components/assistant/assistant-panel"
import { useRouter, useSearchParams } from "next/navigation"
import { useRef } from "react"

export function LibraryAskPanel({ workspaceId, query }: { workspaceId: string; query: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const apiRef = useRef(null)

  const onClose = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("mode")
    router.push(`?${params.toString()}`)
  }

  return (
    <AssistantPanel
      workspaceId={workspaceId}
      apiRef={apiRef}
      onClose={onClose}
      documentSearchEnabled
      surface="dictation"
      title="Ask about documents"
      initialMessage={query || undefined}
      className="flex w-80 shrink-0 flex-col border-l bg-slate-50"
    />
  )
}
