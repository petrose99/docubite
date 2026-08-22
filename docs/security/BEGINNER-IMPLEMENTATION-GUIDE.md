# Beginner guide: taking DocuBite to a NIST CSF 2.0-ready security program

This is the order to follow if you are new to security. Work through it from top to bottom. Do not tell customers the product is "NIST compliant" until every “before launch” item is complete and the evidence register is filled in. NIST CSF is a framework, so the defensible statement is: *“We use a NIST CSF 2.0-aligned security program.”*

## First: understand what you are protecting

This app stores customers’ invoices, receipts, PDFs, images, extracted data, exports, and user accounts. It also sends document content to configured OCR/AI/ASR providers when a workspace enables those features. Treat all customer documents and data as **Confidential**. If you will process medical/pathology files, stop and obtain specialist legal/privacy advice before launch; that is a separate regulated-data project.

## Your first week — required before production

### 1. Complete and approve the paperwork

1. Open `POLICY-SET.md`. At the top or in your document system, add your company legal name, version, date, and approver.
2. Choose people for these roles. One person can hold several roles in a small company, but write their name and a backup down:

   | Role | What they do |
   |---|---|
   | Accountable executive | Accepts risk and approves policies/budget |
   | Security owner | Runs this checklist and quarterly reviews |
   | System owner | Maintains this app and cloud environment |
   | Privacy owner | Approves customer-data/legal decisions |
   | Incident commander | Leads a security incident |

3. Copy and complete the templates in the `templates` folder. Save completed records in a private company drive—not in this public/source repository.
4. Have everyone with access to customer or production data read and acknowledge the policies. Keep their name, date, and policy version.

### 2. Lock down every administrator account

For each service below, enable multi-factor authentication (MFA), remove anyone who does not need access, and use the smallest role that lets each person do their job:

| Service | Where to start | What to retain as evidence |
|---|---|---|
| GitHub | Organization **Settings → Authentication security**; require 2FA; protect `main` in **Settings → Branches** | Screenshot/export of 2FA and branch rules; member list |
| AWS | Root account: enable MFA and never use it day-to-day. Create IAM Identity Center users/roles; do not create everyday access keys. | MFA proof, IAM role list, quarterly access review |
| Vercel | Team **Settings → Members/Security**; require 2FA/SSO if plan supports it; restrict production deploy access | Team member list and deployment roles |
| Domain/DNS | Enable MFA, restrict DNS editing, use a separate registrar account | Account access record |
| Stripe, Resend, Sentry, AI/OCR/ASR vendors | Enable MFA and give only necessary roles/API keys | Access review record |

Never share passwords. Use a reputable business password manager. Give each person their own account.

### 3. Put secrets in the right place

Secrets include `DATABASE_URL`, `BETTER_AUTH_SECRET`, `INTERNAL_WORKER_SECRET`, API keys, and Stripe webhooks. They must never be in GitHub, a ticket, an email, screenshots, or browser code.

1. Generate a fresh long random value for `BETTER_AUTH_SECRET` and `INTERNAL_WORKER_SECRET`—at least 32 random bytes each.
2. Put web-app secrets in Vercel Project **Settings → Environment Variables**, choosing Production only where appropriate.
3. Put AWS worker/database secrets in AWS Secrets Manager. The Terraform variables already expect secret ARNs.
4. Set the same configuration correctly for staging, but use different secrets/data from production.
5. Record only the *secret name, owner, location, and rotation date* in the asset inventory; never record its value.

### 4. Confirm AWS production safeguards

The repository Terraform already defines useful infrastructure. Before applying it, have an AWS-capable engineer run it and review the plan. In the AWS console, confirm:

- S3: **Block all public access** is on, default encryption uses KMS, and no public bucket policy/ACL exists.
- RDS: **Publicly accessible = No**, storage encryption is on, automatic backups are on, deletion protection is on, and Multi-AZ is on if your availability target requires it.
- Network: database and worker are in private subnets; security groups allow only the specific needed traffic.
- KMS: key rotation is enabled and only required roles can use the key.
- Malware scanner: production upload processing fails closed if scanning is unavailable.

Do not change security groups or bucket policies by guessing. If you do not understand an AWS change, use a qualified AWS security engineer.

### 5. Turn on monitoring and prove it works

In AWS, enable CloudTrail, AWS Config, and GuardDuty. Send alerts to an inbox/on-call service that a real person monitors. Configure retention of at least 90 days searchable and 12 months retained, unless your contract or law needs longer. Enable GitHub audit logs (plan permitting) and Vercel activity/deployment notifications.

Create and test alerts for: a public S3 policy change, a new administrator, failed MFA/authentication spike, a production deployment, disabled malware scan, and a suspicious export/download. Save screenshots or exported alert-test results.

## Days 8–30 — required system improvements

These are gaps in the application/deployment that need engineering work. They are not paperwork.

| Improvement | Why it matters | What “done” looks like |
|---|---|---|
| Customer MFA / SSO | Password-only access is insufficient for higher-risk customer data. | MFA is mandatory for platform admins and available/required for customer admins; tests prove enrolment, recovery, and enforcement. |
| Email verification and stronger account-abuse controls | Reduces fake accounts/account takeover. | Verified-email flow, secure password policy, login/reset rate limiting, CAPTCHA/WAF where appropriate, and alerting. |
| Rate limiting/WAF | Protects login, upload, exports, shared links, Stripe and internal routes from abuse. | Vercel/AWS WAF or equivalent is configured, tested, and monitored. |
| Tenant-isolation hardening | This is the most serious SaaS data-disclosure risk. | Follow the staged `DB_SCOPE_GUARD`/RLS plan in the profile; add automated cross-workspace access tests; deploy first to staging. |
| Content Security Policy | Reduces browser injection risk. | Start CSP in report-only mode, review violations, then enforce a minimal allow-list without breaking AI, Stripe, Sentry or other needed features. |
| Security scanning/SBOM | Finds vulnerable code/dependencies before release. | The added `security.yml` runs successfully; add secret, container, and IaC scanning; create an SBOM per release. |
| Recovery testing | A backup is unproven until restored. | Restore database and a sample document in an isolated environment; time it; document RTO/RPO results. |

Make these changes through pull requests, with tests and a rollback plan. Do not enable database RLS in production without staging tests; an incorrect policy can cause an outage.

## Days 31–90 — prove the program operates

1. Send each supplier the questions in the supplier register and obtain a DPA/security terms before it receives customer data. Pay special attention to whether AI/OCR/ASR providers retain content or use it for training.
2. Run a tabletop incident: pretend an API key leaked or an account was taken over. Use the incident template, practise disabling the account, rotating the secret, checking logs, and communicating internally. Record what failed and fix it.
3. Run a restore exercise.
4. Arrange an independent penetration test of the deployed application and cloud configuration; fix the findings.
5. Do the first quarterly access review, risk review, and supplier review.

## Your recurring calendar

| When | Do this |
|---|---|
| Every deployment | PR review, automated tests/security scans, rollback plan, change record |
| Monthly | Asset inventory and vulnerability review; confirm backups and monitoring are healthy |
| Quarterly | Access review, risk register, supplier review, alert test, security leadership review |
| Annually | Policy review, staff training, incident tabletop, recovery restore test, penetration test |
| After any incident or major change | Update risk assessment, controls, policies/runbooks, and evidence |

## What to show a customer or assessor

Use `EVIDENCE-REGISTER.md` as the index. For each control, link the completed template, console export, CI result, ticket, contract, test report, or approved policy. Do not send raw customer data, passwords, API keys, or unrestricted cloud screenshots.
