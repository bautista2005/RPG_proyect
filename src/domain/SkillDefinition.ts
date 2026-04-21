import type { StatusEffectDefinition } from "./StatusEffect.js";

/**
 * Definición estática mínima para skills del battle engine v2.
 */
export type SkillKind = "damage" | "apply_status" | "shield";
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
}
