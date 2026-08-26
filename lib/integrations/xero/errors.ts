import { classifyHttpStatus } from "@/lib/integrations/errors"

/** Xero-specific error mapping. Same status-code-driven classification as every other provider
 * here — this exists so callers have one place to build the error from a Xero response. */
export function xeroApiError(status: number, bodySnippet = ""): Error {
  return classifyHttpStatus(status, bodySnippet)
}
