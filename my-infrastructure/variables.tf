variable "resource_group_location" {
  type        = string
  default     = "uksouth"
  description = "Location of the resource group."
}

variable "resource_group_name_prefix" {
  type        = string
  default     = "rg-sed"
  description = "Prefix for the resource group name."
}

variable "storage_account_name_prefix" {
  type        = string
  default     = "sed"
  description = "Prefix for the storage account name."
}

variable "storage_container_name" {
  type        = string
  default     = "sed-blob"
  description = "Name of the storage container."
}

variable "not_a_real_secret" {
  sensitive   = true
  default   = "made_up_secret"
  description = "Sensitivity level of the storage account."
}
