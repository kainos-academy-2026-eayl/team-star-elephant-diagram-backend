resource "azurerm_resource_group" "main" {
  name     = "${var.resource_group_name_prefix}-${var.environment}"
  location = var.resource_group_location
  tags     = local.common_tags
}

locals {
  common_tags = {
    environment = var.environment
    project     = "team-star-elephant"
    managed_by  = "terraform"
  }
}
