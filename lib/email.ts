import { DemoRequestEmail, type DemoRequestEmailProps } from "@/components/emails/demo-request-email"
import { InvitationEmail } from "@/components/emails/invitation-email"
import { PasswordResetEmail } from "@/components/emails/password-reset-email"
import React from "react"
import { Resend } from "resend"
import config from "./config"

export const resend = new Resend(config.email.apiKey)

/** RESEND_API_KEY has a working-looking default (lib/config.ts), so an unconfigured dev install
 * would send against a placeholder and get a 401 back. Callers check this to decide between
 * mailing the invitation and showing the owner a copyable link instead. */
export const RESEND_PLACEHOLDER_KEY = "please-set-your-resend-api-key-here"
export const isEmailConfigured = () => Boolean(config.email.apiKey) && config.email.apiKey !== RESEND_PLACEHOLDER_KEY

export async function sendWorkspaceInvitationEmail({ email, workspaceName, inviterName, inviteUrl, expiresAt }: { email: string; workspaceName: string; inviterName: string; inviteUrl: string; expiresAt: Date }) {
  const html = React.createElement(InvitationEmail, { workspaceName, inviterName, inviteUrl, expiresAt })

  return await resend.emails.send({
    from: config.email.from,
    to: email,
    subject: `${inviterName} invited you to ${workspaceName} on ${config.app.title}`,
    react: html,
  })
}

export async function sendPasswordResetEmail({ email, resetUrl }: { email: string; resetUrl: string }) {
  const html = React.createElement(PasswordResetEmail, { resetUrl })

  return await resend.emails.send({
    from: config.email.from,
    to: email,
    subject: `Reset your ${config.app.title} password`,
    react: html,
  })
}

/** Goes to the support inbox, not to the requester. `replyTo` is the requester's address so a
 * reply from the inbox reaches them without anyone copying the address out of the body. */
export async function sendDemoRequestEmail(request: DemoRequestEmailProps) {
  const html = React.createElement(DemoRequestEmail, request)

  return await resend.emails.send({
    from: config.email.from,
    to: config.app.supportEmail,
    replyTo: request.email,
    subject: `Demo request — ${request.company} (${request.volume})`,
    react: html,
  })
}
