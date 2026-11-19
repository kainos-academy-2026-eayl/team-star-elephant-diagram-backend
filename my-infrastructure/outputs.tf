output "resource_group_name" {
  value = module.resource_group.name
}

output "resource_group_id" {
  value = module.resource_group.id
}

output "resource_group_location" {
  value = module.resource_group.location
}

output "storage_account_name" {
  value = azurerm_storage_account.practice.name
}

output "storage_account_id" {
  value = azurerm_storage_account.practice.id
}

output "container_registry_name" {
  value = azurerm_container_registry.practice_acr.name
}

output "container_registry_login_server" {
  value = azurerm_container_registry.practice_acr.login_server
}

output "key_vault_uri" {
  description = "Vault endpoint for the backend."
  value       = azurerm_key_vault.backend.vault_uri
}

output "backend_identity_client_id" {
  description = "Client ID used to select the backend managed identity."
  value       = azurerm_user_assigned_identity.backend.client_id
}