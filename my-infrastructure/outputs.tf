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

output "key_vault_name" {
  value = azurerm_key_vault.app.name
}

output "key_vault_id" {
  value = azurerm_key_vault.app.id
}

output "key_vault_uri" {
  value = azurerm_key_vault.app.vault_uri
}

output "app_identity_name" {
  value = azurerm_user_assigned_identity.app.name
}

output "app_identity_id" {
  value = azurerm_user_assigned_identity.app.id
}

output "app_identity_client_id" {
  value = azurerm_user_assigned_identity.app.client_id
}

output "app_identity_principal_id" {
  value = azurerm_user_assigned_identity.app.principal_id
}

output "virtual_network_name" {
  value = azurerm_virtual_network.app.name
}

output "virtual_network_id" {
  value = azurerm_virtual_network.app.id
}
