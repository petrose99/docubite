import config from "@/lib/config"
import React from "react"
import { EmailLayout } from "./email-layout"

interface ReminderEmailProps {
  heading: string
  body: string
  actionUrl: string
  actionLabel: string
}

/** One generic template for every Dext-parity Phase 3 WP3.4 reminder (a review task or an expense
 * claim waiting on a decision) — the specifics live in the caller's heading/body/action, not in a
 * template per entity type, since the shape ("something is waiting, here's the link") is the same
 * for both and will be for whatever else eventually sends a reminder. */
export const ReminderEmail: React.FC<ReminderEmailProps> = ({ heading, body, actionUrl, actionLabel }) => (
  <EmailLayout preview={heading}>
    <h2 style={{ textAlign: "center", color: "#047857" }}>{heading}</h2>
    <p style={{ fontSize: "16px", textAlign: "center" }}>{body}</p>
    <div style={{ margin: "24px 0", textAlign: "center" }}>
      <a
        href={actionUrl}
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
        {actionLabel}
      </a>
    </div>
    <p style={{ fontSize: "13px", color: "#666", textAlign: "center", wordBreak: "break-all" }}>
      Or paste this link into your browser: {actionUrl}
    </p>
    <p style={{ fontSize: "12px", color: "#999", textAlign: "center" }}>
      You are getting this because you can act on it in {config.app.title}.
    </p>
  </EmailLayout>
)
