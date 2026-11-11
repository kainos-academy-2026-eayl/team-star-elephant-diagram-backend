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

variable "environment" {
  type        = string
  default     = "dev"
  description = "The environment for the resources (e.g., dev, staging, prod)."

  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "Environment must be one of 'dev', 'test', or 'prod'."
  }
}
