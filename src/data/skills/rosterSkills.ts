import type { SkillDefinition } from "../../domain/SkillDefinition.js";
import { StatusEffectType } from "../../domain/StatusEffect.js";

export const toxicStab: SkillDefinition = {
  id: "toxic-stab",
  name: "Toxic Stab",
  description: "A precise strike that deals damage and applies poison.",
  kind: "damage",
  targetType: "enemy",
  power: 1,
  energyCost: 1,
  cooldownTurns: 1,
  statusEffect: {
    type: StatusEffectType.Poison,
    durationTurns: 2,
    potency: 2,
  },
};

export const ironGuard: SkillDefinition = {
  id: "iron-guard",
  name: "Iron Guard",
  description: "Grants a shield to an ally or to the caster.",
  kind: "shield",
  targetType: "ally",
  energyCost: 1,
  cooldownTurns: 1,
  statusEffect: {
    type: StatusEffectType.Shield,
    durationTurns: 2,
    potency: 10,
  },
};

export const radiantMend: SkillDefinition = {
  id: "radiant-mend",
  name: "Radiant Mend",
  description: "Restores health to an ally.",
  kind: "heal",
  targetType: "ally",
  power: 10,
  energyCost: 1,
  cooldownTurns: 1,
};

export const concussiveBlow: SkillDefinition = {
  id: "concussive-blow",
  name: "Concussive Blow",
  description: "Deals damage and stuns the target.",
  kind: "damage",
  targetType: "enemy",
  power: 3,
  energyCost: 1,
  cooldownTurns: 2,
  statusEffect: {
    type: StatusEffectType.Stun,
    durationTurns: 1,
  },
};

export const rosterSkills: SkillDefinition[] = [toxicStab, ironGuard, radiantMend, concussiveBlow];

export const rosterSkillMap = Object.fromEntries(rosterSkills.map((skill) => [skill.id, skill]));
