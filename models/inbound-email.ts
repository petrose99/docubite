// Deliberately NOT a "use server" module, matching every other models/*.ts helper here: this
// trusts the token/sender it is handed. app/api/inbound-email/route.ts does the signature check
// and is the only caller.
import { createIngestionItem } from "@/lib/ingestion"
import { isSupportedDocumentBuffer } from "@/models/documents"
import { EXTENSION_MIME_TYPES } from "@/lib/zip-ingestion"
import { prisma } from "@/lib/db"
import { createFile, getFileTemplates } from "@/models/files"
import { getWorkspaceMembers } from "@/models/workspaces"
import crypto from "crypto"

/** Generates (or returns the existing) per-workspace inbound routing token. Refused outright for
 * a healthcare workspace — unencrypted email is not an acceptable channel for ePHI, so there is
 * deliberately no address for one to send to, not just a disabled-looking one. */
export async function ensureInboundEmailToken(workspaceId: string): Promise<string> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { inboundEmailToken: true, industry: true } })
  if (workspace.industry === "healthcare") throw new Error("inbound_email_disabled_for_clinical")
  if (workspace.inboundEmailToken) return workspace.inboundEmailToken
  const token = crypto.randomBytes(16).toString("base64url")
  await prisma.workspace.update({ where: { id: workspaceId }, data: { inboundEmailToken: token } })
  return token
}

export const resolveWorkspaceByInboundToken = (token: string) => prisma.workspace.findUnique({ where: { inboundEmailToken: token }, select: { id: true, industry: true } })

/** Default allowlist: any address already a member of the workspace. There is no UI yet to widen
 * this to non-member senders (a bookkeeper's own inbox, say) — that is real future scope, not
 * something to half-build unrequested while this channel is still dark. */
export async function isSenderAllowed(workspaceId: string, senderEmail: string): Promise<boolean> {
  const normalized = senderEmail.trim().toLowerCase()
  if (!normalized) return false
  const members = await getWorkspaceMembers(workspaceId)
  return members.some((member) => member.user.email.toLowerCase() === normalized)
}

async function ensureEmailIntakeFile(workspaceId: string) {
  const existing = await prisma.documentFile.findFirst({ where: { workspaceId, name: "Email intake" } })
  if (existing) return existing
  const owner = await prisma.workspaceMember.findFirst({ where: { workspaceId, role: "owner" }, orderBy: { createdAt: "asc" }, select: { userId: true } })
  if (!owner) throw new Error("workspace_has_no_owner")
  return createFile({ workspaceId, userId: owner.userId, name: "Email intake" })
}

function inferMimeType(filename: string): string | null {
  const extension = filename.split(".").pop()?.toLowerCase() ?? ""
  return EXTENSION_MIME_TYPES[extension] ?? null
}

export type InboundEmailAttachment = { filename: string; contentType: string; base64Content: string }

/** One inbound email, already authenticated by the route (signature + token resolved to a
 * workspace) — this is the business logic: is the sender allowed, and if so, ingest every
 * attachment through the exact same pipeline every other intake channel uses. Attachments land in
 * a dedicated "Email intake" file (auto-created, mirroring ensureDictationFile's pattern) rather
 * than a file the sender has no way to specify. */
export async function processInboundEmail(input: { workspaceId: string; from: string; attachments: InboundEmailAttachment[] }): Promise<{ accepted: number; rejected: number }> {
  if (!(await isSenderAllowed(input.workspaceId, input.from))) throw new Error("sender_not_allowed")

  const file = await ensureEmailIntakeFile(input.workspaceId)
  const templates = await getFileTemplates(input.workspaceId, file.id)
  const template = templates.find((candidate) => candidate.code === "generic") ?? templates[0]
  if (!template) throw new Error("no_template_available")

  let accepted = 0
  let rejected = 0
  for (const attachment of input.attachments) {
    const buffer = Buffer.from(attachment.base64Content, "base64")
    const mimeType = inferMimeType(attachment.filename)
    if (!mimeType || !buffer.length || !isSupportedDocumentBuffer(buffer, mimeType)) { rejected++; continue }
    const outcome = await createIngestionItem({ workspaceId: input.workspaceId, fileId: file.id, templateId: template.id, source: "email", filename: attachment.filename, mimeType, buffer })
    if (outcome.outcome === "accepted" || outcome.outcome === "duplicate") accepted++
    else rejected++
  }
  return { accepted, rejected }
}
