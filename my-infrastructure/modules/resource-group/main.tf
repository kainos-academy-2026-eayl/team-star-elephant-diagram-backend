resource "azurerm_resource_group" "main" {
  name     = var.name
  location = var.resource_group_location
  tags     = var.tags
}
