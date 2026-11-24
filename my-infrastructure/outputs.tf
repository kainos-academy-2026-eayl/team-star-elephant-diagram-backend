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
