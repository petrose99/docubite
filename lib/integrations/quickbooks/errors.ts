import { classifyHttpStatus } from "@/lib/integrations/errors"

/** QuickBooks-specific error mapping. QuickBooks' Fault payload doesn't change the retry decision
 * (that's purely the HTTP status, same as every other provider here) — this exists so callers have
 * one place to build the error from a QuickBooks response without repeating classifyHttpStatus. */
export function quickbooksApiError(status: number, bodySnippet = ""): Error {
  return classifyHttpStatus(status, bodySnippet)
}
