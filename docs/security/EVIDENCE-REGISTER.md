# Security evidence register

Record a link, owner, collection date, review date, and retention location for every item. Evidence must describe the production environment, not merely a local repository configuration.

| CSF function | Evidence required | Frequency |
|---|---|---|
| Govern | Signed policies, RACI, training acknowledgements, meeting minutes, risk register, exceptions/acceptances, approved supplier inventory | annual/quarterly |
| Identify | Asset inventory; data-flow and data classification; threat/risk assessments; privacy/legal requirements; remediation tracker | monthly/quarterly |
| Protect | MFA/SSO and access-review exports; privileged-account list; secret-manager access logs; encryption/KMS configuration; S3 public-access block; RDS/VPC/security-group evidence; MDM/endpoint compliance; retention/deletion tickets | quarterly |
| Detect | CloudTrail, AWS Config/GuardDuty, Vercel/GitHub audit-log configuration; alert routing/tests; log retention configuration; monitoring review records | quarterly |
| Respond | Incident plan/contact list; tabletop results; incident tickets/timeline/evidence; notification decisions; post-incident corrective actions | annual/per incident |
| Recover | Backup configuration; isolated restore test results; RTO/RPO approval and actual results; recovery communications exercise | annual |
| Secure development | PR approvals; CI results; SAST/secret/dependency/container scan outputs; SBOMs; vulnerability exceptions; penetration-test report and remediation evidence | each release/monthly/annual |
| Suppliers | Due-diligence questionnaire, DPA/security addendum, data-processing map, annual reassessment, AI data-use approval | before use/annual |

## Minimum production configuration checklist

- [ ] AWS account logging, configuration monitoring, threat detection, alerting, and immutable/archive log destination are enabled and tested.
- [ ] Vercel, GitHub, DNS, email, Stripe, AWS, monitoring, and support consoles require MFA; least-privilege roles are reviewed quarterly.
- [ ] S3 public access is blocked; bucket policy only permits required principals and TLS; KMS key policy is least privilege; access logging/CloudTrail data events are enabled as appropriate.
- [ ] RDS is private, encrypted, deletion-protected, backed up to approved RPO, and restore-tested; production uses Multi-AZ where availability requires it.
- [ ] `BETTER_AUTH_SECRET` and `INTERNAL_WORKER_SECRET` are unique production secrets; all third-party keys are in managed secret stores and rotation ownership/dates are recorded.
- [ ] DB scope guard/RLS rollout is completed with tests and a rollback plan; tenant-isolation testing is part of release testing.
- [ ] Rate limiting/WAF and bot/credential-stuffing protection are enabled for auth, upload, export, shared-link, and internal endpoints.
- [ ] AI/OCR/ASR suppliers are approved for the exact content and region; their retention/training/subprocessor terms are recorded.
- [ ] Backups, incidents, and recovery exercises have passed and corrective actions are closed.
