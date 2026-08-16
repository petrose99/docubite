# Private PostgreSQL for the Document Inbox production baseline. The application
# uses DATABASE_URL from Secrets Manager; enable IAM authentication so Vercel's
# AWS OIDC role can use short-lived database credentials in production.
resource "aws_db_subnet_group" "document_inbox" {
  name = "${var.name}-postgres"
  subnet_ids = var.database_subnet_ids
}

resource "aws_db_instance" "document_inbox" {
  identifier = "${var.name}-postgres"
  engine = "postgres"
  engine_version = var.database_engine_version
  instance_class = var.database_instance_class
  allocated_storage = var.database_allocated_storage_gb
  max_allocated_storage = var.database_max_allocated_storage_gb
  storage_type = "gp3"
  storage_encrypted = true
  kms_key_id = aws_kms_key.documents.arn

  db_name = "document_inbox"
  username = "document_inbox"
  manage_master_user_password = true
  iam_database_authentication_enabled = true

  db_subnet_group_name = aws_db_subnet_group.document_inbox.name
  vpc_security_group_ids = var.database_security_group_ids
  publicly_accessible = false
  multi_az = var.database_multi_az
  backup_retention_period = 7
  copy_tags_to_snapshot = true
  deletion_protection = var.database_deletion_protection
  skip_final_snapshot = var.database_skip_final_snapshot
  apply_immediately = false
}
