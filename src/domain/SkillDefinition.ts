import type { StatusEffectDefinition } from "./StatusEffect.js";

/**
 * Definición estática mínima para skills del battle engine.
 */
export type SkillKind = "damage" | "apply_status" | "shield" | "heal";
export type SkillTargetType = "self" | "ally" | "enemy";

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  kind: SkillKind;
  targetType: SkillTargetType;
  power?: number;
  statusEffect?: StatusEffectDefinition;
  shieldAmount?: number;
  energyCost?: number;
  cooldownTurns?: number;
}
