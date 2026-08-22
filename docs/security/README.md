# Security and NIST CSF 2.0 program

This directory is the security-program source of truth for DocuBite. It is written for the production service described in the repository: a multi-tenant document-processing SaaS hosted on Vercel and AWS, with PostgreSQL, private S3 storage, Fargate workers, and optional third-party AI/OCR/ASR services.

## Important scope statement

NIST CSF 2.0 is a voluntary, risk-based framework, not a certifiable standard. No repository change can make an organization "NIST compliant" by itself. Compliance requires approved policies, assigned owners, deployed controls, operating evidence, and periodic independent assessment. The documents here establish the target profile and the evidence that must exist before making a public conformance claim.

Start with `BEGINNER-IMPLEMENTATION-GUIDE.md` if you are new to security. Use `NIST-CSF-2.0-PROFILE.md` as the implementation plan, `POLICY-SET.md` as the policy baseline, and `EVIDENCE-REGISTER.md` to collect proof. The named accountable executive must approve the policies before they take effect. Fill-in records are in `templates/`; copy completed versions to a private company drive, never back into the source repository.

## Required decisions before production

1. Name the executive accountable for cybersecurity, the system owner, privacy owner, incident commander, and backup delegates.
2. Classify the service as handling confidential customer financial documents; treat health/pathology use as a separate, high-risk profile until legal and privacy requirements are approved.
3. Adopt the target profile in this directory: Tier 3 (Repeatable) for production, with Tier 2 permitted only during a documented, time-bounded launch exception.
4. Complete every Critical and High item in the profile, then approve residual risk in the risk register.
5. Do not claim certification or compliance to customers without an assessment of deployed infrastructure and operating evidence.

## Review cadence

The security owner reviews the profile and risk register quarterly and after a material architecture, supplier, or regulatory change. Policies are reviewed at least annually; the incident and recovery exercises occur at least annually and after any material change.

## Authoritative sources

- [NIST CSF 2.0](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=957258)
- [NIST CSF 2.0 implementation examples](https://www.nist.gov/document/csf-20-implementations-pdf)
- [NIST organizational-profile quick-start guide](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1301.pdf)
