import config from "@/lib/config"
import React from "react"
import { EmailLayout } from "./email-layout"

interface InvitationEmailProps {
  workspaceName: string
  inviterName: string
  inviteUrl: string
  expiresAt: Date
}

/** Styling stays inline, as in password-reset-email.tsx: EmailLayout only injects a <style> block for the
 * document chrome, and mail clients that strip <style> would render everything else unstyled. */
export const InvitationEmail: React.FC<InvitationEmailProps> = ({ workspaceName, inviterName, inviteUrl, expiresAt }) => (
  <EmailLayout preview={`Join ${workspaceName} on ${config.app.title}`}>
    <h2 style={{ textAlign: "center", color: "#047857" }}>You have been invited to {workspaceName}</h2>
    <p style={{ fontSize: "16px", textAlign: "center" }}>
      {inviterName} invited you to collaborate on documents in the <strong>{workspaceName}</strong> workspace.
    </p>
    <div style={{ margin: "24px 0", textAlign: "center" }}>
      <a
        href={inviteUrl}
        style={{
          display: "inline-block",
          padding: "12px 24px",
          backgroundColor: "#047857",
          color: "#ffffff",
          borderRadius: "6px",
          fontSize: "16px",
          fontWeight: "bold",
          textDecoration: "none",
        }}
      >
        Accept invitation
      </a>
    </div>
    <p style={{ fontSize: "13px", color: "#666", textAlign: "center", wordBreak: "break-all" }}>
      Or paste this link into your browser: {inviteUrl}
    </p>
    <p style={{ fontSize: "14px", color: "#666", textAlign: "center" }}>
      This invitation expires on {expiresAt.toUTCString()}.
    </p>
    <p style={{ fontSize: "14px", color: "#666", textAlign: "center" }}>
      If you were not expecting this invitation, you can safely ignore this email.
    </p>
  </EmailLayout>
)
