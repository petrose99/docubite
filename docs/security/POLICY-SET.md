# Required security policies

**Approval:** These policies are inactive until signed by the accountable executive. Replace bracketed fields, record approver/date/version, publish them to personnel, and capture acknowledgements.

## 1. Information security and risk management policy

The organization protects customer, employee, and company information using the NIST CSF 2.0 Tier 3 target profile. The accountable executive owns risk acceptance; the security owner operates this program; the system owner maintains DocuBite; and the privacy owner approves privacy and regulatory decisions. Risks are recorded, rated for likelihood and impact, assigned an owner and due date, reviewed quarterly, and accepted only in writing with an expiry date. Material system, supplier, data, or threat changes trigger reassessment. Policy exceptions require documented compensating controls, executive approval, and review at least every 90 days.

## 2. Access control and authentication policy

Every person uses a unique account; shared administrator accounts are prohibited. MFA is mandatory for all workforce, cloud, source-control, CI/CD, billing, DNS, email, monitoring, and support-administration accounts. Access follows least privilege, is approved by the system/data owner, and is reviewed quarterly. Privileged access is limited, logged, and separated from routine use where the provider supports it. Departures and role changes are disabled within 24 hours. Customer access is scoped to their workspace; platform administration is restricted to approved administrators. Break-glass access is time-bound, logged, and reviewed within one business day. Customer MFA/SSO is required for privileged customer roles and before processing high-risk regulated data.

## 3. Data protection, retention, and cryptography policy

Data are classified as Public, Internal, Confidential, or Restricted. Customer documents, extracted values, exports, credentials, security logs, and health-related information are Confidential or Restricted. Restricted data may only be processed by approved suppliers under contract and in approved regions. Encryption in transit uses TLS; production documents use KMS-backed S3 encryption and databases/backups use encryption at rest. Secrets are stored in managed secret stores, never in source code, tickets, logs, or chat. The system does not log document bodies, prompts containing document data, or raw source payloads. Customer data retention follows the signed customer agreement; the default repository behavior of keeping data for the workspace lifetime must be expressly disclosed and configurable. Deletion requests, legal holds, backup expiry, supplier deletion, and secure disposal are documented and evidenced.

## 4. Secure development, change, and vulnerability management policy

All production changes use reviewed pull requests, CI checks, and a rollback plan proportionate to risk. Security-impacting changes require threat analysis and security-owner approval. Production secrets never appear in code or build logs. CI must run linting, tests, type checks, secret scanning, SAST, dependency/SBOM scanning, and container scanning. Critical vulnerabilities are mitigated within 72 hours; High within 14 days; Medium within 30 days; Low within 90 days, unless a documented risk exception is approved. Emergency changes are retrospectively reviewed within one business day. Dependencies, base images, and GitHub Actions are pinned and updated under the same process. An independent penetration test occurs annually and after major architectural changes.

## 5. Security monitoring and logging policy

Security logs include administrative access, authentication failures/successes where available, privilege changes, deployment/configuration changes, cloud control-plane events, storage-access policy changes, malware-scan failures, incident actions, and relevant data export/download events. Logs must not contain source documents, extracted values, credentials, tokens, or prompts. Security logs are access-controlled, time-synchronized, monitored by an assigned on-call function, searchable for at least 90 days, and retained for at least 12 months unless contract/law requires longer. Alerts are tested at least quarterly and tuned after incidents.

## 6. Incident response policy

All suspected security events are reported immediately to [incident contact]. The incident commander records time, reporter, systems/data affected, severity, decisions, evidence, containment, communications, and recovery. The team preserves evidence, contains harm, rotates exposed credentials, suspends affected accounts, and engages suppliers/legal/privacy as needed. Only designated legal/privacy personnel authorize external notification. Incidents receive a root-cause and corrective-action report within 10 business days of closure. Tabletop exercises occur at least annually; the plan is updated after every exercise or incident.

## 7. Business continuity and disaster recovery policy

The system owner maintains approved RTO/RPO values, dependency map, recovery runbooks, contact list, and alternate communications path. Production backups are encrypted, access-controlled, and protected from accidental deletion. Database and representative document restores are tested in an isolated environment at least annually and after material recovery changes. Results include start/end time, recovered scope, integrity validation, RTO/RPO result, and corrective actions. Recovery communications are coordinated by the incident commander and customer-support owner.

## 8. Supplier security policy

Before a supplier receives Confidential/Restricted data or privileged access, the privacy and security owners assess its security posture, data location, sub-processors, encryption, retention/deletion, AI training use, incident notice, access controls, business continuity, and exit/return/deletion terms. Required agreements include an appropriate DPA and confidentiality/security terms. Suppliers are tiered by data/access criticality and reviewed at least annually. No AI/OCR/ASR provider may receive customer content until its contractual data-use and retention terms are approved for that use.

## 9. Acceptable use and endpoint policy

Workforce members may access production only from managed or approved devices protected by full-disk encryption, current OS/browser patches, screen lock, anti-malware/EDR where applicable, and no shared accounts. Production data may not be downloaded to unmanaged devices or personal storage. Phishing, password sharing, unapproved browser extensions, and copying customer data into unapproved AI tools are prohibited. Violations are investigated and may result in access removal.
