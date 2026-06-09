import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
  AdapterSkillEntry,
} from "@paperclipai/adapter-utils";
import { readPaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";

/**
 * listSkills + syncSkills — minimal "persistent" implementation.
 *
 * Skills are physically installed on the OpenClaw side (workspace symlinks to
 * /home/admin/clawd/skills/<name>/SKILL.md), not pushed by the adapter. So we
 * just acknowledge whatever desiredSkills are configured on the agent.
 *
 * Reads desiredSkills from adapter config (config.paperclipSkillSync.desiredSkills)
 * which is where the server stores them after /skills/sync.
 */

function snapshot(desiredSkills: string[]): AdapterSkillSnapshot {
  const entries: AdapterSkillEntry[] = desiredSkills.map((key) => ({
    key,
    runtimeName: key.split("/").pop() ?? key,
    desired: true,
    managed: false,
    state: "configured",
    origin: "external_unknown",
    originLabel: "OpenClaw workspace (symlink-managed)",
    locationLabel: "/home/admin/clawd/skills/<name>/SKILL.md",
    readOnly: true,
    sourcePath: null,
  }));
  return {
    adapterType: "openclaw_gateway",
    supported: true,
    mode: "persistent",
    desiredSkills,
    entries,
    warnings: [],
  };
}

export async function listSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  const pref = readPaperclipSkillSyncPreference(ctx.config);
  return snapshot(pref.desiredSkills);
}

export async function syncSkills(
  _ctx: AdapterSkillContext,
  desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return snapshot(desiredSkills);
}
