resource "aws_kms_key" "documents" {
  description             = "${var.name} document-inbox encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_s3_bucket" "documents" {
  bucket_prefix = "${var.name}-documents-"
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "aws:kms" kms_master_key_id = aws_kms_key.documents.arn } }
}

resource "aws_iam_role" "worker" {
  name_prefix = "${var.name}-worker-"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "worker_execution" {
  role = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role_policy" "worker" {
  role = aws_iam_role.worker.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.documents.arn}/*" },
    { Effect = "Allow", Action = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"], Resource = aws_kms_key.documents.arn },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [var.database_url_secret_arn, var.openai_api_key_secret_arn, var.internal_worker_secret_arn, var.mineru_api_token_secret_arn] }
  ] })
}

resource "aws_cloudwatch_log_group" "worker" {
  name = "/ecs/${var.name}-worker"
  retention_in_days = 30
}
resource "aws_ecs_cluster" "main" {
  name = "${var.name}-cluster"
}

locals {
  worker_environment = [
    { name = "NODE_ENV", value = "production" }, { name = "AWS_REGION", value = var.aws_region },
    { name = "AWS_S3_DOCUMENTS_BUCKET", value = aws_s3_bucket.documents.id }, { name = "AWS_S3_KMS_KEY_ID", value = aws_kms_key.documents.arn },
    { name = "MALWARE_SCAN_URL", value = var.malware_scan_url }
  ]
  worker_secrets = [
    { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn }, { name = "OPENAI_API_KEY", valueFrom = var.openai_api_key_secret_arn },
    { name = "INTERNAL_WORKER_SECRET", valueFrom = var.internal_worker_secret_arn },
    { name = "MINERU_API_TOKEN", valueFrom = var.mineru_api_token_secret_arn }
  ]
}
resource "aws_ecs_task_definition" "worker" {
  family = "${var.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode = "awsvpc"
  cpu = 512
  memory = 1024
  execution_role_arn = aws_iam_role.worker.arn
  task_role_arn = aws_iam_role.worker.arn
  container_definitions = jsonencode([{ name = "worker", image = var.worker_image, essential = true, command = ["npx", "tsx", "worker/job-worker.ts"], environment = local.worker_environment, secrets = local.worker_secrets, logConfiguration = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.worker.name, awslogs-region = var.aws_region, awslogs-stream-prefix = "worker" } } }])
}
resource "aws_ecs_service" "worker" {
  name = "${var.name}-worker"
  cluster = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count = 1
  launch_type = "FARGATE"
  network_configuration {
    subnets = var.vpc_subnet_ids
    security_groups = var.worker_security_group_ids
    assign_public_ip = false
  }
}
