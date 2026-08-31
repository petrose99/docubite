import { classifyHttpStatus } from "@/lib/integrations/errors"

export function bigcapitalApiError(status: number, bodySnippet = ""): Error {
  return classifyHttpStatus(status, bodySnippet)
}
