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

resource "azurerm_key_vault" "backend" {
  name                = "kv-sed-${local.environment}-${random_integer.suffix.result}"
  location            = module.resource_group.location
  resource_group_name = module.resource_group.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  purge_protection_enabled   = true

  tags = local.common_tags
}

resource "azurerm_user_assigned_identity" "backend" {
  name                = "id-sed-backend-${local.environment}"
  location            = module.resource_group.location
  resource_group_name = module.resource_group.name

  tags = local.common_tags
}

resource "azurerm_role_assignment" "backend_secrets" {
  scope                = azurerm_key_vault.backend.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.backend.principal_id
}

resource "azurerm_container_app_environment" "backend" {
  name                = "cae-sed-${local.environment}"
  location            = module.resource_group.location
  resource_group_name = module.resource_group.name

  tags = local.common_tags
}

resource "azurerm_role_assignment" "backend_acr_pull" {
  scope                = azurerm_container_registry.practice_acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.backend.principal_id
}

resource "azurerm_container_app" "backend" {
  name                         = "ca-sed-backend-${local.environment}"
  container_app_environment_id = azurerm_container_app_environment.backend.id
  resource_group_name          = module.resource_group.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.backend.id]
  }

  registry {
    server   = azurerm_container_registry.practice_acr.login_server
    identity = azurerm_user_assigned_identity.backend.id
  }

  template {
    container {
      name   = "backend"
      image  = "${azurerm_container_registry.practice_acr.login_server}/backend:${var.backend_image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "KEY_VAULT_URL"
        value = azurerm_key_vault.backend.vault_uri
      }

      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.backend.client_id
      }

      env {
        name  = "SECRETS_SOURCE"
        value = "key-vault"
      }
    }
  }

  ingress {
    external_enabled           = true
    target_port                = 3001
    transport                  = "http"
    allow_insecure_connections = false

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  tags = local.common_tags

  depends_on = [
    azurerm_role_assignment.backend_acr_pull,
    azurerm_role_assignment.backend_secrets,
  ]

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
    ]
  }
}