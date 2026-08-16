import config from "@/lib/config"
import React from "react"
import { EmailLayout } from "./email-layout"

export interface DemoRequestEmailProps {
  name: string
  email: string
  company: string
  volume: string
  message?: string
}

const row: React.CSSProperties = { fontSize: "15px", margin: "0 0 10px" }
const label: React.CSSProperties = { color: "#78716c", display: "inline-block", minWidth: "120px" }

/** Goes to the support inbox rather than to the person who filled the form in, so it is written
 * as an internal notification: no marketing chrome, every submitted field visible at a glance. */
export const DemoRequestEmail: React.FC<DemoRequestEmailProps> = ({ name, email, company, volume, message }) => (
  <EmailLayout preview={`Demo request from ${name} at ${company}`}>
    <h2 style={{ color: "#047857", marginTop: 0 }}>New {config.app.title} demo request</h2>
    <p style={row}><span style={label}>Name</span><strong>{name}</strong></p>
    <p style={row}><span style={label}>Work email</span><a href={`mailto:${email}`} style={{ color: "#047857" }}>{email}</a></p>
    <p style={row}><span style={label}>Company</span>{company}</p>
    <p style={row}><span style={label}>Monthly volume</span>{volume}</p>
    {message && <>
      <p style={{ ...row, marginTop: "20px" }}><span style={label}>Message</span></p>
      <p style={{ fontSize: "15px", whiteSpace: "pre-wrap", background: "#f5f5f4", borderRadius: "6px", padding: "12px", margin: 0 }}>{message}</p>
    </>}
  </EmailLayout>
)
