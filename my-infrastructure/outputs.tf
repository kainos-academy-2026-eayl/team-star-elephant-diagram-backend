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
