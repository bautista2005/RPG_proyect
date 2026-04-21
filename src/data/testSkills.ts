import type { SkillDefinition } from "../domain/SkillDefinition.js";
import { StatusEffectType } from "../domain/StatusEffect.js";

export const venomStrike: SkillDefinition = {
  id: "venom-strike",
  name: "Venom Strike",
  description: "Deals light damage and applies poison.",
  kind: "damage",
  targetType: "enemy",
  power: 2,
  statusEffect: {
    type: StatusEffectType.Poison,
    durationTurns: 2,
    potency: 3,
  },
};

export const shieldAlly: SkillDefinition = {
  id: "shield-ally",
  name: "Shield Ally",
  description: "Grants a temporary shield to an ally.",
  kind: "shield",
  targetType: "ally",
  shieldAmount: 8,
  statusEffect: {
    type: StatusEffectType.Shield,
    durationTurns: 2,
    potency: 8,
  },
};

export const bash: SkillDefinition = {
  id: "bash",
  name: "Bash",
  description: "Deals damage and stuns the target.",
  kind: "damage",
  targetType: "enemy",
  power: 4,
  statusEffect: {
    type: StatusEffectType.Stun,
    durationTurns: 1,
  },
};

export const testSkills: SkillDefinition[] = [venomStrike, shieldAlly, bash];
