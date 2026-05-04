terraform {
  required_providers {
    railway = {
      source  = "terraform-community-providers/railway"
      version = "~> 0.3"
    }
  }
}

provider "railway" {
  token = var.railway_token
}

variable "railway_token" {
  description = "Railway API token"
  sensitive   = true
}

resource "railway_project" "agent" {
  name = "my-agent"
}

resource "railway_service" "bot" {
  project_id = railway_project.agent.id
  name       = "bot"
}

resource "railway_plugin" "postgres" {
  project_id = railway_project.agent.id
  plugin     = "postgresql"
}

output "bot_service_id" {
  value = railway_service.bot.id
}
