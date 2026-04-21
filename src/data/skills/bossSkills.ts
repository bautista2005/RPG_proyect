import type { SkillDefinition } from "../../domain/SkillDefinition.js";
import { StatusEffectType } from "../../domain/StatusEffect.js";

export const crushingSlam: SkillDefinition = {
  id: "crushing-slam",
  name: "Crushing Slam",
  description: "A heavy blow that deals high damage and briefly stuns.",
  kind: "damage",
  targetType: "enemy",
  power: 7,
  energyCost: 1,
  cooldownTurns: 1,
  statusEffect: {
    type: StatusEffectType.Stun,
    durationTurns: 1,
  },
};

export const tyrantRush: SkillDefinition = {
  id: "tyrant-rush",
  name: "Tyrant Rush",
  description: "A brutal chase-down strike that punishes exposed backliners and long fights.",
  kind: "damage",
  targetType: "enemy",
  power: 9,
  energyCost: 1,
  cooldownTurns: 2,
};

export const bossSkills: SkillDefinition[] = [crushingSlam, tyrantRush];
