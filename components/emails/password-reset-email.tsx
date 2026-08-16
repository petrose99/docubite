import config from "@/lib/config"
import React from "react"
import { EmailLayout } from "./email-layout"

interface PasswordResetEmailProps {
  resetUrl: string
}

/** Styling stays inline, as in invitation-email.tsx: EmailLayout only injects a <style> block for
 * the document chrome, and mail clients that strip <style> would render everything else unstyled. */
export const PasswordResetEmail: React.FC<PasswordResetEmailProps> = ({ resetUrl }) => (
  <EmailLayout preview={`Reset your ${config.app.title} password`}>
    <h2 style={{ textAlign: "center", color: "#047857" }}>Reset your password</h2>
    <p style={{ fontSize: "16px", textAlign: "center" }}>
      Someone asked to reset the password for this {config.app.title} account. Choose a new one with the button below.
    </p>
    <div style={{ margin: "24px 0", textAlign: "center" }}>
      <a
        href={resetUrl}
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
        Choose a new password
      </a>
    </div>
    <p style={{ fontSize: "13px", color: "#666", textAlign: "center", wordBreak: "break-all" }}>
      Or paste this link into your browser: {resetUrl}
    </p>
    <p style={{ fontSize: "14px", color: "#666", textAlign: "center" }}>
      This link expires in one hour. If you did not ask for it, you can safely ignore this email — your password stays as it is.
    </p>
  </EmailLayout>
)
