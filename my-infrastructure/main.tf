locals {
  environment = var.environment

  common_tags = {
    environment = local.environment
    project     = "team-star-elephant"
    managed_by  = "terraform"
    purpose     = "practice storage for team-star-elephant"
  }
  backend_app_name  = "sed-backend-${local.environment}-${random_integer.suffix.result}"
  frontend_app_name = "sed-frontend-${local.environment}-${random_integer.suffix.result}"
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
  public_network_access_enabled = true
  soft_delete_retention_days    = 7
  purge_protection_enabled      = true
  tags                          = local.common_tags

  network_acls {
    default_action = "Allow"
    bypass         = "AzureServices"
  }
}

resource "azurerm_user_assigned_identity" "app" {
  name                = "id-sed-app-${local.environment}-${random_integer.suffix.result}"
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  tags                = local.common_tags
}

resource "azurerm_container_app_environment" "app" {
  name                  = "cae-sed-${local.environment}-${random_integer.suffix.result}"
  location              = module.resource_group.location
  resource_group_name   = module.resource_group.name
  public_network_access = "Enabled"
  tags                  = local.common_tags
}

resource "azurerm_container_app" "backend" {
  name                         = local.backend_app_name
  container_app_environment_id = azurerm_container_app_environment.app.id
  resource_group_name          = module.resource_group.name
  revision_mode                = "Single"
  tags                         = local.common_tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.practice_acr.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  ingress {
    external_enabled           = false
    target_port                = 3001
    transport                  = "http"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {

    min_replicas = var.backend_min_replicas
    max_replicas = var.backend_max_replicas

    container {
      name   = "sed-backend-${local.environment}-${random_integer.suffix.result}"
      image  = "${azurerm_container_registry.practice_acr.login_server}/backend:${var.backend_image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "FRONTEND_BASE_URL"
        value = "https://${local.frontend_app_name}.${azurerm_container_app_environment.app.default_domain}"
      }
      env {
        name        = "JWT_SECRET"
        secret_name = "jwt-secret"
      }

      env {
        name        = "ADMIN_ACCESS_TOKEN_SECRET"
        secret_name = "admin-access-token-secret"
      }

      env {
        name        = "ADMIN_REFRESH_TOKEN_SECRET"
        secret_name = "admin-refresh-token-secret"
      }

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }

      dynamic "env" {
        for_each = var.backend_env
        content {
          name  = env.key
          value = env.value
        }
      }
    }

    container {
      name   = "postgres"
      image  = "${azurerm_container_registry.practice_acr.login_server}/postgres:17-alpine"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "POSTGRES_USER"
        value = local.environment
      }

      env {
        name  = "POSTGRES_DB"
        value = "app_${local.environment}"
      }

      env {
        name        = "POSTGRES_PASSWORD"
        secret_name = "postgres-password"
      }
    }
  }

  secret {
    name                = "jwt-secret"
    key_vault_secret_id = "${azurerm_key_vault.app.vault_uri}secrets/jwt-secret"
    identity            = azurerm_user_assigned_identity.app.id
  }

  secret {
    name                = "admin-access-token-secret"
    key_vault_secret_id = "${azurerm_key_vault.app.vault_uri}secrets/admin-access-token-secret"
    identity            = azurerm_user_assigned_identity.app.id
  }

  secret {
    name                = "admin-refresh-token-secret"
    key_vault_secret_id = "${azurerm_key_vault.app.vault_uri}secrets/admin-refresh-token-secret"
    identity            = azurerm_user_assigned_identity.app.id
  }

  secret {
    name                = "database-url"
    key_vault_secret_id = "${azurerm_key_vault.app.vault_uri}secrets/database-url"
    identity            = azurerm_user_assigned_identity.app.id
  }

  secret {
    name                = "postgres-password"
    key_vault_secret_id = "${azurerm_key_vault.app.vault_uri}secrets/postgres-password"
    identity            = azurerm_user_assigned_identity.app.id
  }
}

resource "azurerm_container_app" "frontend" {
  name                         = "sed-frontend-${local.environment}-${random_integer.suffix.result}"
  container_app_environment_id = azurerm_container_app_environment.app.id
  resource_group_name          = module.resource_group.name
  revision_mode                = "Single"
  tags                         = local.common_tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.practice_acr.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  ingress {
    external_enabled           = true
    target_port                = 3000
    transport                  = "http"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.frontend_min_replicas
    max_replicas = var.frontend_max_replicas

    container {
      name   = "sed-frontend-${local.environment}-${random_integer.suffix.result}"
      image  = "${azurerm_container_registry.practice_acr.login_server}/frontend:${var.frontend_image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "API_BASE_URL"
        value = "https://${local.backend_app_name}.internal.${azurerm_container_app_environment.app.default_domain}"
      }

      dynamic "env" {
        for_each = var.frontend_env
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }
}
