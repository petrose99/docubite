# DocuBite

Take a bite out of document busywork. DocuBite extracts the data bookkeepers need from invoices, receipts, bank statements, IDs, and custom PDF/image documents — including handwritten notes and low-quality scans. Upload files, review the AI-extracted fields, then search and export clean CSV data for your existing bookkeeping workflow.

It is not accounting software: there are no transactions, categories, projects, currency conversion, invoice creation, accounting integrations, CSV imports, IMAP connections, or public developer API.

## What is included

- Marketing site, 14-day free trial signup, and a book-a-demo form
- Secure workspaces with owner/member roles and invitations
- Invoice, Receipt, and custom PDF/image extraction templates
- Hosted MinerU document parsing, with platform-managed AI structuring and workspace opt-in
- Human review, workspace search, and streamed CSV exports
- Sources and reviewed data retained for the life of the workspace, held in private encrypted storage

## Production architecture

- **Vercel:** Next.js app, authentication, workspace UI, Stripe Checkout/portal/webhooks, and signed internal APIs.
- **AWS:** private KMS-encrypted S3 document storage; Fargate job worker; RDS PostgreSQL.
- Browsers never connect directly to S3 or RDS. The application authorizes all workspace actions and streams source views through it.

See [AWS deployment](infra/aws/README.md) for the required DNS, IAM, Vercel-to-AWS, malware-scanning, and Terraform setup.

## Local development

```bash
npm install
npx prisma migrate deploy
npm run dev
```

`npm install` generates the Prisma client for you through the `postinstall` script, which runs
`prisma generate` and then `scripts/fix-next-admin-paths.mjs`. **Please do not remove that script
or replace it with a bare `prisma generate`.** The admin console
(`@premieroctet/next-admin`, mounted at `/admin-next`) does not work on Prisma 7 without it: its
Prisma generator writes ESM import specifiers using the platform path separator, which is invalid
on Windows, and it imports `@prisma/client/runtime/library`, an entry point Prisma 7 removed. Both
patches land inside `node_modules` and are erased by every install, so they have to be reapplied
automatically. If you ever need to rerun them by hand, use `npm run db:generate`.

Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL`. Sign-in is email + password; to also offer "Continue with Google", set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and register `{BASE_URL}/api/auth/callback/google` as an authorised redirect URI. Without both variables the app boots normally and simply hides the Google button. With no Resend key, password-reset links are printed to the server console. Local source objects are stored under `data/document-sources`; production must configure private AWS storage and a malware scanner.

## License and attribution

This project reuses parts of TaxHacker’s MIT-licensed PDF/image rendering and structured extraction work. The original [MIT License](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md) remain in this repository.
