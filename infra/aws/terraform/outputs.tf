output "documents_bucket" { value = aws_s3_bucket.documents.id }
output "kms_key_arn" { value = aws_kms_key.documents.arn }
output "rds_endpoint" {
  value = aws_db_instance.document_inbox.address
}
output "rds_master_secret_arn" {
  value = aws_db_instance.document_inbox.master_user_secret[0].secret_arn
  sensitive = true
}
