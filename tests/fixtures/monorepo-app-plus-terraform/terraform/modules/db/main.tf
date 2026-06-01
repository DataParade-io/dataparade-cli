resource "aws_db_instance" "main" {
  identifier        = "app-db"
  engine            = "postgres"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
}

resource "aws_subnet" "private" {
  vpc_id     = "vpc-12345"
  cidr_block = "10.0.1.0/24"
}
