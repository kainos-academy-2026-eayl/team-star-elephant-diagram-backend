locals {
  environment = {
    default = "dev"
    test    = "test"
    prod    = "prod"
  }[terraform.workspace]

  common_tags = {
    environment = local.environment
    project     = "team-star-elephant"
    managed_by  = "terraform"
  }
}

module "resource_group" {
  source                  = "./modules/resource-group"
  name                    = "${var.resource_group_name_prefix}-${local.environment}"
  resource_group_location = var.resource_group_location
  tags                    = local.common_tags
}


