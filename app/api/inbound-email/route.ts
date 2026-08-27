import config from "@/lib/config"
import { processInboundEmail, resolveWorkspaceByInboundToken } from "@/models/inbound-email"

/** Inbound email intake (WP13) — shipped dark: built and tested against recorded provider
 * fixtures (see route.test.ts), but with no inbound DNS or provider (Postmark inbound, SES)
 * actually pointed at it yet. `config.inboundEmail.enabled` is off until EMAIL_INBOUND_SECRET is
 * set, and that is a deliberate production decision, not a placeholder to fill in — see
 * lib/config.ts.
 *
 * Payload shape follows Postmark's inbound webhook (To/From/Attachments[].Name/ContentType/
 * Content), the recommended provider in the roadmap. Swapping to SES's SNS-wrapped shape would
 * touch only the parsing in this file, not models/inbound-email.ts.
 *
 * "Signature verification": a shared bearer secret (EMAIL_INBOUND_SECRET) rather than Postmark's
 * own HMAC scheme, which does not cover inbound webhooks — Postmark's own docs recommend a secret
 * URL segment or Basic Auth for inbound instead. A bearer secret gets the same guarantee (only the
 * configured provider can call this route) without hard-coding one provider's URL convention. */

type PostmarkAttachment = { Name?: string; ContentType?: string; Content?: string }
type PostmarkInboundPayload = { To?: string; From?: string; Attachments?: PostmarkAttachment[] }

/** Postmark's To/From are full mailbox strings ("Name <address@host>" or a bare address) — this
 * pulls out just the address either way. */
function extractEmailAddress(value: string): string | null {
  const bracketed = value.match(/<([^>]+)>/)
  const candidate = (bracketed ? bracketed[1] : value).trim()
  return candidate.includes("@") ? candidate : null
}

function extractInboundToken(toAddress: string): string | null {
  const match = toAddress.match(/^([^@]+)@/)
  return match ? match[1] : null
}

export async function POST(request: Request): Promise<Response> {
  if (!config.inboundEmail.enabled) return Response.json({ error: "not_configured" }, { status: 503 })

  const authorization = request.headers.get("authorization")
  if (authorization !== `Bearer ${config.inboundEmail.secret}`) return Response.json({ error: "unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null) as PostmarkInboundPayload | null
  const toAddress = body?.To ? extractEmailAddress(body.To) : null
  const fromAddress = body?.From ? extractEmailAddress(body.From) : null
  if (!toAddress || !fromAddress) return Response.json({ error: "invalid_payload" }, { status: 400 })

  const token = extractInboundToken(toAddress)
  const workspace = token ? await resolveWorkspaceByInboundToken(token) : null
  if (!workspace) return Response.json({ error: "unknown_recipient" }, { status: 404 })
  // Disabled entirely for clinical workspaces, not merely unrouted — see the model's own comment
  // on why a clinical workspace never even has a token to send to. This check exists anyway in
  // case a workspace's mode changed after a token was issued.
  if (workspace.productMode === "clinical") return Response.json({ error: "disabled_for_clinical" }, { status: 403 })

  try {
    const result = await processInboundEmail({
      workspaceId: workspace.id,
      from: fromAddress,
      attachments: (body?.Attachments ?? [])
        .filter((attachment): attachment is Required<PostmarkAttachment> => Boolean(attachment.Name && attachment.ContentType && attachment.Content))
        .map((attachment) => ({ filename: attachment.Name, contentType: attachment.ContentType, base64Content: attachment.Content })),
    })
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "processing_failed"
    if (message === "sender_not_allowed") return Response.json({ error: message }, { status: 403 })
    return Response.json({ error: message }, { status: 500 })
  }
}
