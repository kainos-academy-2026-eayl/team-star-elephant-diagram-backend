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

variable "environment" {
  type        = string
  description = "Environment to deploy (dev or prod)."

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "backend_min_replicas" {
  type    = number
  default = 1
  nullable = false
   validation {
     condition     = var.backend_min_replicas == 1
     error_message = "Backend runs an ephemeral PostgreSQL sidecar; backend_min_replicas must be 1 to prevent data loss on scale-to-zero."
  }
}

variable "backend_max_replicas" {
  type    = number
  default = 1

  validation {
    condition     = var.backend_max_replicas <= 1
    error_message = "Backend runs a PostgreSQL sidecar; more than one replica would create separate databases."
  }
}

variable "frontend_min_replicas" {
  type    = number
  default = null
}

variable "frontend_max_replicas" {
  type    = number
  default = null
}

variable "backend_env" {
  type        = map(string)
  default     = {}
  description = "Non-secret backend environment variables."
}

variable "frontend_env" {
  type        = map(string)
  default     = {}
  description = "Non-secret frontend environment variables."
}
