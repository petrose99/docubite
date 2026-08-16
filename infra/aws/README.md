# AWS document storage and processing

Terraform creates a private, KMS-encrypted S3 bucket for document sources and a Fargate worker that drains the document processing queue. It does not expose the bucket publicly.

## Before apply

1. Terraform provisions a fresh, private RDS PostgreSQL instance. Deploy the application's clean migration baseline there. Create a `DATABASE_URL` secret for the Fargate connection (the managed RDS master secret is exposed as Terraform output); do not use the old TaxHacker database.
2. Configure Vercel-to-AWS access with OIDC and RDS IAM authentication (or a private RDS Proxy connection) for the Next.js app. Do not place permanent database credentials in browser code or a public endpoint.
3. Provide private Fargate subnets/security groups with egress to the model endpoint, scanner, S3, and RDS. The scanner URL must be private and production must fail closed if it is unavailable.

```bash
cd infra/aws/terraform
terraform init
terraform apply \
  -var='aws_region=eu-west-1' \
  -var='worker_image=ACCOUNT.dkr.ecr.eu-west-1.amazonaws.com/document-inbox:latest' \
  -var='database_url_secret_arn=arn:aws:secretsmanager:...' \
  -var='openai_api_key_secret_arn=arn:aws:secretsmanager:...' \
  -var='internal_worker_secret_arn=arn:aws:secretsmanager:...' \
  -var='malware_scan_url=https://scanner.private/scan' \
  -var='vpc_subnet_ids=["subnet-..."]' \
  -var='worker_security_group_ids=["sg-..."]'
  -var='database_subnet_ids=["subnet-..."]' \
  -var='database_security_group_ids=["sg-..."]'
```

The Fargate worker long-polls the document processing queue (`worker/job-worker.ts`) and performs heavy PDF/image rendering (ghostscript/graphicsmagick) off Vercel's tighter execution limits. It logs error codes only—never document bodies, base64 images, prompts, or extracted values.
