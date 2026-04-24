// ============================================
// TEAM CONFIG LOADING
// ============================================

import { existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import { getTeamsYamlSearchPaths } from "../../shared/paths.ts";

export interface TeamConfig {
  manager: string;
  members: string[];
  description?: string;
}

export type TeamsYaml = Record<string, TeamConfig>;

export function loadTeamsYaml(cwd: string): TeamsYaml | null {
  const searchPaths = getTeamsYamlSearchPaths(cwd);

  const teams: TeamsYaml = {};
  const teamPriorities: Record<string, number> = {};
  let foundAny = false;

  for (const { path, priority } of searchPaths) {
    if (existsSync(path)) {
      foundAny = true;
      const content = readFileSync(path, "utf-8");
      const parsed = parseTeamsYaml(content);

      for (const [name, config] of Object.entries(parsed)) {
        if (!teams[name] || priority > (teamPriorities[name] ?? 0)) {
          teams[name] = config;
          teamPriorities[name] = priority;
        }
      }
    }
  }

  return foundAny && Object.keys(teams).length > 0 ? teams : null;
}

function parseTeamsYaml(yamlContent: string): TeamsYaml {
  const parsed = yaml.load(yamlContent);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const teams: TeamsYaml = {};

  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid team config for '${name}': expected a mapping`);
    }

    const config = value as Record<string, unknown>;
    const manager = typeof config.manager === "string" ? config.manager.trim() : "";
    const members = Array.isArray(config.members)
      ? config.members
          .filter((member): member is string => typeof member === "string")
          .map((member) => member.trim())
          .filter(Boolean)
      : [];
    const description =
      typeof config.description === "string" ? config.description.trim() : undefined;

    if (!manager) {
      throw new Error(`Invalid team config for '${name}': missing manager`);
    }

    teams[name] = { manager, members, description };
  }

  return teams;
}
