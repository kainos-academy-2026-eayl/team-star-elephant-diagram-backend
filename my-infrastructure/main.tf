resource "azurerm_resource_group" "main" {
  name     = "${var.resource_group_name_prefix}-${local.environment}"
  location = var.resource_group_location
  tags     = local.common_tags
}

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
