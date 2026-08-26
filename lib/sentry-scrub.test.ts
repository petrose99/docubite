import { describe, expect, it } from "vitest"
import { scrubEvent, scrubUuids } from "@/lib/sentry-scrub"
import type { ErrorEvent, EventHint } from "@sentry/nextjs"

describe("scrubUuids", () => {
  it("replaces a uuid with a placeholder", () => {
    expect(scrubUuids("/api/documents/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/source")).toBe("/api/documents/:id/source")
  })

  it("replaces every uuid in a string, not just the first", () => {
    const url = "/workspaces/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/files/2c8e7bcd-bbfd-4b2d-9b5d-ab8dfbbd4bec"
    expect(scrubUuids(url)).toBe("/workspaces/:id/files/:id")
  })

  it("leaves a string with no uuid untouched", () => {
    expect(scrubUuids("/login")).toBe("/login")
  })
})

const hint = {} as EventHint

describe("scrubEvent", () => {
  it("drops console and fetch breadcrumbs but keeps others, scrubbing ids in their message", () => {
    const event = {
      breadcrumbs: [
        { category: "console", message: "extracted total: $4,200.00" },
        { category: "fetch", message: "GET /api/documents/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/source" },
        { category: "navigation", message: "/workspaces/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/files" },
      ],
    } as unknown as ErrorEvent

    const result = scrubEvent(event, hint)

    expect(result?.breadcrumbs).toHaveLength(1)
    expect(result?.breadcrumbs?.[0]).toMatchObject({ category: "navigation", message: "/workspaces/:id/files" })
  })

  it("drops request body, cookies, and headers but keeps a scrubbed url", () => {
    const event = {
      request: {
        url: "https://app.example.com/api/documents/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/source",
        data: { reviewedData: { total: "$4,200.00" } },
        cookies: { session: "secret" },
        headers: { authorization: "Bearer secret" },
        method: "GET",
      },
    } as unknown as ErrorEvent

    const result = scrubEvent(event, hint)

    expect(result?.request).toEqual({ url: "https://app.example.com/api/documents/:id/source", method: "GET" })
  })

  it("drops the extra bag entirely", () => {
    const event = { extra: { rawExtraction: { total: "$4,200.00" } } } as unknown as ErrorEvent
    const result = scrubEvent(event, hint)
    expect(result).not.toHaveProperty("extra")
  })
})
