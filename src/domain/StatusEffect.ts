/**
 * Tipos y contratos base para estados alterados.
 * La duración se procesa al inicio del turno de la unidad afectada.
 */
export enum StatusEffectType {
  Poison = "poison",
  Stun = "stun",
  Shield = "shield",
  Burn = "burn",
}

export interface StatusEffectDefinition {
  type: StatusEffectType;
  durationTurns: number;
  potency?: number;
}

export interface ActiveStatusEffect extends StatusEffectDefinition {
  sourceUnitId?: string;
  remainingTurns: number;
}
