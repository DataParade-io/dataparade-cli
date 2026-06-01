terraform {
  required_version = ">= 1.0"
}

resource "aws_db_instance" "main" {
  identifier     = "app-db"
  engine           = "postgres"
  instance_class   = "db.t3.micro"
  allocated_storage = 20
}

resource "aws_s3_bucket" "data" {
  bucket = "example-app-data"
}

resource "aws_iam_role" "lambda_exec" {
  name = "lambda_exec_role"
  assume_role_policy = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
}

resource "aws_lambda_function" "api" {
  function_name = "api"
  role            = aws_iam_role.lambda_exec.arn
  handler         = "index.handler"
  runtime         = "nodejs20.x"

  environment {
    variables = {
      DATABASE_URL = aws_db_instance.main.address
    }
  }
}
