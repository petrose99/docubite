# DocuBite NIST CSF 2.0 organizational profile

**Version:** 1.0 | **Owner:** Security Owner (assign before approval) | **Review:** quarterly

## System and risk context

In scope are the Next.js application and APIs, Vercel project, GitHub repository and CI/CD, AWS S3/KMS/RDS/ECS/Fargate/CloudWatch, PostgreSQL data, staff endpoints used for administration, production secrets, customer documents and exports, and the suppliers that process them (Vercel, AWS, GitHub, Stripe, Resend, MinerU, model/embedding/ASR providers, and Sentry if enabled).

The highest-risk data are uploaded documents, extracted values, exports, credentials, payment metadata, and any health-related or direct identifiers. The primary threats are tenant data disclosure, account takeover, compromised CI/CD or dependency, malicious uploads, third-party AI disclosure, ransomware/data loss, and unavailable document processing.

Target: CSF Tier 3, **Repeatable**, for all Functions. Tier 4 is not asserted. A legal review is required before processing special-category data, including health/pathology documents.

Legend: **Implemented** = code/infrastructure evidence exists; **Partial** = design or some implementation exists but operating evidence/control is missing; **Gap** = must be completed before production assurance.

## GOVERN (GV)

| CSF category | Target outcome and action | Current state |
|---|---|---|
| GV.OC Organizational context | Maintain system boundary, data-flow diagram, legal/regulatory requirements, customer commitments, and data classification. Reassess quarterly. | Partial |
| GV.RM Risk management strategy | Approve risk appetite, Tier 3 target, risk method, acceptance authority, and quarterly risk register. | Gap |
| GV.RR Roles/responsibilities | Name accountable executive, security owner, privacy owner, incident commander, system owner, and backups; keep RACI current. | Gap |
| GV.PO Policy | Approve, communicate, train on, and annually review the policy set. Track acknowledgements. | Gap |
| GV.OV Oversight | Quarterly security review must inspect risks, incidents, vulnerabilities, supplier status, access reviews, tests, and plan progress. | Gap |
| GV.SC Cybersecurity supply chain risk | Inventory suppliers, assign data/access tier, execute DPA/security review, define breach notice and exit requirements. | Partial |

## IDENTIFY (ID)

| CSF category | Target outcome and action | Current state |
|---|---|---|
| ID.AM Asset management | Maintain inventory of cloud accounts/projects, repositories, APIs, domains, data stores, secrets, integrations, privileged accounts, and production endpoints. Reconcile monthly. | Partial |
| ID.RA Risk assessment | Perform and record initial and quarterly threat/risk assessment; track remediation and accepted residual risk. | Gap |
| ID.IM Improvement | Turn findings from audits, tests, incidents, and metrics into tracked actions with owners/dates. | Partial |

## PROTECT (PR)

| CSF category | Target outcome and action | Current state |
|---|---|---|
| PR.AA Identity, authentication, access control | Enforce MFA for GitHub, AWS, Vercel, Stripe, DNS, email, Sentry, and all administration. Use SSO where available; unique identities; least privilege; quarterly access reviews; revoke access within 24 hours of departure. Add user MFA or a documented compensating control before handling high-risk data. | Partial |
| PR.AT Awareness and training | Security/privacy onboarding plus annual training; phishing and incident exercises; retain completion evidence. | Gap |
| PR.DS Data security | Classify data; TLS everywhere; KMS S3 encryption and encrypted RDS; documented retention/deletion; protect exports and backups; confirm provider data-use/retention terms. | Partial |
| PR.PS Platform security | Hardened configuration baseline; private S3/RDS; EDR/full-disk encryption/patching for administrator devices; secure DNS and email domain controls. | Partial |
| PR.IR Technology infrastructure resilience | Define RTO/RPO; multi-AZ RDS for production; test restore; monitor storage and job queue capacity; maintain break-glass procedures. | Partial |

## DETECT (DE)

| CSF category | Target outcome and action | Current state |
|---|---|---|
| DE.CM Continuous monitoring | Centralize AWS CloudTrail, CloudWatch, Vercel, GitHub, auth/admin, database, and WAF logs; synchronize time; alert on privileged access, auth abuse, public-storage change, failed malware scan, deployment/config change, and anomalous export/download. | Partial |
| DE.AE Adverse event analysis | Create alert triage runbook, severity model, on-call rotation, evidence preservation, and alert tuning review. | Gap |

## RESPOND (RS)

| CSF category | Target outcome and action | Current state |
|---|---|---|
| RS.MA Incident management | Use the incident plan; maintain 24/7 contact path; classify, contain, eradicate, recover, and document incidents. | Gap |
| RS.AN Incident analysis | Preserve logs, identify affected tenants/data, engage legal/privacy, and record root cause. | Gap |
| RS.CO Incident reporting/communication | Define customer, regulator, insurer, supplier, and law-enforcement notification decisions; only legal/privacy approves notices. | Gap |
| RS.MI Incident mitigation | Test credential rotation, session revocation, account suspension, deployment rollback, storage isolation, and provider disablement. | Partial |

## RECOVER (RC)

| CSF category | Target outcome and action | Current state |
|---|---|---|
| RC.RP Recovery plan execution | Maintain recovery runbook; restore a representative database and documents to isolated environment at least annually; compare to RTO/RPO. | Partial |
| RC.CO Recovery communication | Maintain service-status, customer-support, and executive communication templates; complete after-action report. | Gap |

## Prioritized remediation plan

| Priority | Due | Action | Acceptance evidence |
|---|---:|---|---|
| Critical | Before production | Assign roles; approve policies, data classification, risk appetite, and this profile. | Signed approvals, RACI, training acknowledgement list |
| Critical | Before production | Enforce MFA/least privilege for every administrator and cloud/CI/SaaS account; remove shared accounts; store secrets only in managed stores. | Access inventory, MFA screenshots/config export, quarterly-review record |
| Critical | Before production | Enable CloudTrail organization/account trail, AWS Config, GuardDuty, Vercel/GitHub audit logs, alert routing, and log retention appropriate to contracts/regulation (minimum 90 days searchable, 12 months retained unless law requires longer). | Log/alert configuration and test alerts |
| Critical | Before production | Verify private AWS networking/security groups, S3 Block Public Access and KMS key policy, RDS encryption/backups/deletion protection, and production malware scanner fail-closed behavior. | Terraform plan/state, screenshots, test results |
| Critical | Before production | Establish a tested incident response, customer notification, and backup/restore process; set and approve RTO/RPO. | Exercise report and restore evidence |
| High | 30 days | Enable `DB_SCOPE_GUARD=warn`, remediate unscoped findings, then `throw`; test/enable database RLS only after a staging rollout and rollback plan. | Clean monitoring period, test results, change record |
| High | 30 days | Improve user authentication: verified email, password policy, rate limiting/abuse detection, and MFA/SSO plan. Require MFA for admins now. | Configuration, automated tests, penetration test evidence |
| High | 30 days | Add SAST, secret scanning, dependency/SBOM and container-image scanning with a documented vulnerability SLA and release gate. Pin GitHub Actions to commit SHAs. | CI runs, SBOM, exception register |
| High | 30 days | Perform supplier reviews and DPAs for all processors; specifically validate AI/OCR/ASR data retention, training use, location, sub-processors, deletion, and breach notice. | Supplier register and signed agreements |
| High | 60 days | Establish secure headers/CSP rollout, WAF/rate limiting, API abuse monitoring, and authenticated download/export audit alerts. | Security test report and monitoring evidence |
| Medium | 90 days | Independent penetration test and remediation; tabletop incident and restore exercise; administrator endpoint baseline/MDM. | Reports and remediation tickets |

## Deployment controls already evidenced in the repository

- Tenant-scoped application queries and optional PostgreSQL RLS (`lib/workspace-scope.ts`, `lib/db-rls.ts`).
- Private S3 with KMS encryption and public-access block; encrypted non-public RDS with backups and optional Multi-AZ (`infra/aws/terraform`).
- Private Fargate task networking, managed secrets, malware scanner configuration, and limited worker IAM.
- Workspace membership, suspension, platform-admin guards, document/admin audit records, and authenticated document source access.
- Document payloads and prompts are deliberately excluded from application logs; Sentry is optional.
- Pull-request CI runs lint, tests, type checking, and Docker build; Dependabot is configured weekly.

These facts must be verified in the deployed accounts; a repository configuration is not proof that a production control is operating.
