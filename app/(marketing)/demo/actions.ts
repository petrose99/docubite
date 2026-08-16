"use server"

import { VOLUME_OPTIONS } from "@/app/(marketing)/demo/volume-options"
import { isEmailConfigured, sendDemoRequestEmail } from "@/lib/email"
import { z } from "zod"

const schema = z.object({
  name: z.string().trim().min(2, "Please give us a name we can use").max(120),
  email: z.string().trim().toLowerCase().email("That does not look like an email address").max(200),
  company: z.string().trim().min(2, "Please tell us where you work").max(160),
  volume: z.enum(VOLUME_OPTIONS),
  message: z.string().trim().max(2000).optional(),
})

/** Per-address throttle, in process memory.
 *
 * Deliberately not a database table: this guards a public form against a fat-fingered double
 * submit and a trivially scripted flood, not against a determined attacker, and a persistent
 * store for it would be a schema change plus a cleanup job for no real gain. On a multi-instance
 * deployment each instance keeps its own window, which is fine for what this is defending. */
const lastSubmission = new Map<string, number>()
const RATE_LIMIT_MS = 60_000

export type DemoRequestResult = { ok: true } | { ok: false; error: string }

export async function submitDemoRequest(formData: FormData): Promise<DemoRequestResult> {
  // The honeypot: a field hidden from people and left empty by them, filled in by bots that
  // complete every input they find. Anything in it means "accept quietly, send nothing".
  if (String(formData.get("website") || "").trim()) return { ok: true }

  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    company: formData.get("company"),
    volume: formData.get("volume"),
    message: formData.get("message") || undefined,
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Please check the form and try again" }

  const request = parsed.data
  const now = Date.now()
  const previous = lastSubmission.get(request.email)
  if (previous && now - previous < RATE_LIMIT_MS) return { ok: false, error: "We already have your request — give us a minute to read it." }
  lastSubmission.set(request.email, now)

  // Without a Resend key there is nothing to send with, and a silent drop makes the form
  // untestable on a dev install. Log the payload instead, matching the password-reset path.
  if (!isEmailConfigured()) {
    console.log("[DEV] Demo request:", request)
    return { ok: true }
  }

  try {
    await sendDemoRequestEmail({ ...request, message: request.message })
  } catch (error) {
    // The address is released again so a genuine retry is not blocked by the throttle for a
    // failure that was ours.
    lastSubmission.delete(request.email)
    console.error("Failed to send demo request", error)
    return { ok: false, error: "We could not send that just now. Please try again in a moment." }
  }

  return { ok: true }
}
