import type { NextAdminOptions } from "@premieroctet/next-admin"

/** Configuration for the generated CRUD console.
 *
 * Mounted at /admin-next while the hand-built /admin console still exists, so the two can be
 * compared before either is removed. Shared by the page and the API route — both must be given
 * the *same* options object, or the UI will offer an action the handler rejects.
 *
 * The important part of this file is what is switched OFF. next-admin generates CRUD straight
 * onto the tables, and three of them have invariants that live in application code, not in the
 * database — so a raw row edit silently breaks them:
 *
 *   • Workspace delete. `deleteWorkspace()` in models/workspaces.ts sweeps the blob store before
 *     dropping the row, because nothing in Postgres knows those objects exist. A plain DELETE
 *     cascades every child row and strands every uploaded PDF forever, unrecoverably and with no
 *     error. Deletion is disabled here; use the Danger Zone on /admin/workspaces/<id>.
 *
 *   • DocumentProcessingJob. Flipping `status` back to "queued" without also zeroing `attempts`
 *     leaves the job at or above the permanent-failure threshold in lib/document-processing.ts,
 *     so it dies for good on the first transient error. Read-only here.
 *
 *   • User.role and User.suspendedAt. Editing these directly skips the last-admin check, the
 *     self-modification check, the session sweep, and the audit row. Read-only here.
 *
 * Everything genuinely useful to browse — subscriptions, usage periods, templates, invitations,
 * webhook events — stays fully editable, which is what a generated console is good at.
 *
 * NOTE: no `toString` (or any other function) may appear in this object. The same options are
 * handed to <NextAdmin>, which is a Client Component, and React refuses to serialise a function
 * across that boundary — the page 500s with "Functions cannot be passed directly to Client
 * Components". next-admin's own docs show `toString` because the Pages Router serialised
 * differently; under the App Router it has to go.
 */
export const options: NextAdminOptions = {
  title: "DocuBite data",
  model: {
    User: {
      title: "Users",
      icon: "UsersIcon",
      permissions: ["edit"],
      list: {
        display: ["id", "email", "name", "role", "suspendedAt", "emailVerified", "createdAt"],
        search: ["email", "name"],
        defaultSort: { field: "createdAt", direction: "desc" },
      },
      edit: {
        // role and suspendedAt are deliberately absent — see the header. They are changed from
        // /admin/users, which enforces the guards and writes an AdminAuditEvent.
        display: ["email", "name", "avatar", "emailVerified"],
      },
    },
    Workspace: {
      title: "Workspaces",
      icon: "BuildingOfficeIcon",
      // No "delete": a cascade here orphans every stored document. See the header.
      permissions: ["edit"],
      list: {
        display: ["id", "name", "kind", "aiEnabled", "hipaaMode", "createdAt"],
        search: ["name"],
        defaultSort: { field: "createdAt", direction: "desc" },
      },
      // hipaaMode is deliberately absent from edit: setWorkspaceHipaaModeAction force-revokes
      // every file's linkAccess back to "none" in the same transaction as the flag flip — a raw
      // field edit here would turn the flag on while leaving existing share links live, which is
      // exactly the invariant this header warns about.
      edit: { display: ["name", "kind", "aiEnabled"] },
    },
    WorkspaceSubscription: {
      title: "Subscriptions",
      icon: "CreditCardIcon",
      list: {
        display: ["id", "planCode", "status", "currentPeriodEnd", "cancelAtPeriodEnd", "updatedAt"],
        defaultSort: { field: "updatedAt", direction: "desc" },
      },
    },
    WorkspaceUsagePeriod: {
      title: "Usage periods",
      icon: "ChartBarIcon",
      list: { display: ["id", "periodStart", "periodEnd", "inboundDocumentCount", "aiExtractionCount"] },
    },
    DocumentProcessingJob: {
      title: "Processing jobs",
      icon: "QueueListIcon",
      // Read-only: a retry has to reset `attempts`, which a field editor will not do.
      // An empty array is how next-admin spells read-only — "read" is implicit and its
      // PermissionType only covers create/edit/delete.
      permissions: [],
      list: {
        display: ["id", "type", "status", "attempts", "errorCode", "scheduledAt"],
        defaultSort: { field: "scheduledAt", direction: "desc" },
      },
    },
    StripeWebhookEvent: {
      title: "Stripe events",
      icon: "BoltIcon",
      permissions: [],
      list: {
        display: ["id", "stripeEventId", "type", "status", "attempts", "errorCode", "createdAt"],
        defaultSort: { field: "createdAt", direction: "desc" },
      },
    },
    AdminAuditEvent: {
      title: "Admin audit log",
      icon: "ShieldCheckIcon",
      // Append-only by design. The whole value of this table is that nobody can edit it.
      permissions: [],
      list: {
        display: ["id", "type", "targetUserId", "targetWorkspaceId", "createdAt"],
        defaultSort: { field: "createdAt", direction: "desc" },
      },
    },
    Subprocessor: {
      title: "Subprocessors (BAA tracking)",
      icon: "BuildingLibraryIcon",
      // Fully editable: unlike DocumentAuditEvent this is a compliance worksheet, not an audit
      // trail — someone needs to update baaStatus and notes as BAAs actually get executed.
      permissions: ["edit"],
      list: {
        display: ["name", "purpose", "baaStatus", "region", "updatedAt"],
        defaultSort: { field: "name", direction: "asc" },
      },
      edit: { display: ["name", "purpose", "dataReceived", "baaStatus", "region", "notes"] },
    },
    DocumentAuditEvent: {
      title: "Document audit log",
      icon: "DocumentMagnifyingGlassIcon",
      // Append-only, enforced twice over: the database trigger installed by
      // 20260822000000_hipaa_audit_hardening refuses UPDATE/DELETE outright, and this is read-only
      // on top of that. Was write-only before this entry existed — nothing in the product could
      // answer "who accessed this document" without a direct database query.
      permissions: [],
      list: {
        display: ["id", "type", "outcome", "workspaceId", "documentId", "actorId", "sourceIp", "createdAt"],
        defaultSort: { field: "createdAt", direction: "desc" },
      },
    },
  },
}
