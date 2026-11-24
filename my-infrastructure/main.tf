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

resource "azurerm_container_registry" "practice_acr" {
  name                = "${var.container_registry_name_prefix}${local.environment}${random_integer.suffix.result}"
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  sku                 = "Basic"
  admin_enabled       = false
}

data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "app" {
  name                          = "kv-sed-${local.environment}-${random_integer.suffix.result}"
  resource_group_name           = module.resource_group.name
  location                      = module.resource_group.location
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  public_network_access_enabled = false
  soft_delete_retention_days    = 7
  purge_protection_enabled      = true
  tags                          = local.common_tags

  network_acls {
    default_action = "Deny"
    bypass         = "None"
  }
}
