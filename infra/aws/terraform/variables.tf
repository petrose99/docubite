variable "aws_region" { type = string }
variable "name" {
  type = string
  default = "document-inbox"
}
variable "worker_image" { type = string }
variable "database_url_secret_arn" { type = string }
variable "openai_api_key_secret_arn" { type = string }
variable "internal_worker_secret_arn" { type = string }
variable "mineru_api_token_secret_arn" { type = string }
variable "malware_scan_url" { type = string }
variable "vpc_subnet_ids" { type = list(string) }
variable "worker_security_group_ids" { type = list(string) }
variable "database_subnet_ids" { type = list(string) }
variable "database_security_group_ids" { type = list(string) }
variable "database_instance_class" {
  type = string
  default = "db.t4g.medium"
}
variable "database_engine_version" {
  type = string
  default = "17.2"
}
variable "database_allocated_storage_gb" {
  type = number
  default = 20
}
variable "database_max_allocated_storage_gb" {
  type = number
  default = 100
}
variable "database_multi_az" {
  type = bool
  default = true
}
variable "database_deletion_protection" {
  type = bool
  default = true
}
variable "database_skip_final_snapshot" {
  type = bool
  default = false
}
