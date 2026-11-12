terraform {
  backend "azurerm" {
    resource_group_name  = "rg-sed-tfstate"
    storage_account_name = "sedtfstate4644"
    container_name       = "tfstate"
    key                  = "backend-dev.tfstate"
    use_azuread_auth     = true
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~>4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~>3.0"
    }
  }
}

provider "azurerm" {
  features {}
}
