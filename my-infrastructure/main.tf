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
    purpose     = "practice storage for team-star-elephant"
  }
}
resource "random_integer" "suffix" {
  min = 1000
  max = 9999
}
module "resource_group" {
  source                  = "./modules/resource-group"
  name                    = "${var.resource_group_name_prefix}-${local.environment}"
  resource_group_location = var.resource_group_location
  tags                    = local.common_tags
}

resource "azurerm_storage_account" "practice" {
  name                     = "${var.storage_account_name_prefix}${local.environment}${random_integer.suffix.result}"
  resource_group_name      = module.resource_group.name
  location                 = module.resource_group.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  tags                     = local.common_tags
}

resource "azurerm_storage_container" "practice_container" {
  name                  = "${var.storage_container_name}${local.environment}${random_integer.suffix.result}"
  storage_account_id    = azurerm_storage_account.practice.id
  container_access_type = "private"
}


