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

variable "container_registry_name_prefix" {
  type        = string
  default     = "sedcontainerregistry"
  description = "Prefix for the container registry name."
}

variable "backend_image_tag" {
  type        = string
  description = "Existing ACR backend image tag to deploy."

  validation {
    condition     = can(regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", var.backend_image_tag))
    error_message = "backend_image_tag must be a valid, non-empty container image tag."
  }
}

variable "frontend_image_tag" {
  type        = string
  description = "Existing ACR frontend image tag to deploy."

  validation {
    condition     = can(regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", var.frontend_image_tag))
    error_message = "frontend_image_tag must be a valid, non-empty container image tag."
  }
}
