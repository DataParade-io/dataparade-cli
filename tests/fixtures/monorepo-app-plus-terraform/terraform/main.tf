terraform {
  required_version = ">= 1.0"
}

module "db" {
  source = "./modules/db"
}
