"use client"

import dynamic from "next/dynamic"

/** Univer is a canvas renderer that touches `window` and `document` at import time, so it
 * cannot be server-rendered — and pulling it into the server bundle would cost several hundred
 * kilobytes on a page that never runs it. `ssr: false` needs a client component to live in,
 * which is all this module is. */
export const UniverSheetLoader = dynamic(() => import("./univer-sheet").then((module) => module.UniverSheet), {
  ssr: false,
  loading: () => <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">Loading spreadsheet…</div>,
})
