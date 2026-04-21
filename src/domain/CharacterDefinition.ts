import type { CharacterTrait } from "./CharacterTrait.js";
import type { PassiveId } from "./PassiveDefinition.js";

/**
 * Define el contrato de un personaje fuera del estado de batalla.
 * Sirve como fuente de datos estáticos para crear unidades en combate.
 */
export interface CharacterStats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
}

export type CharacterAiProfile = "aggressive" | "defensive" | "supportive" | "control";

export interface CharacterDefinition {
  id: string;
  name: string;
  role?: string;
  aiProfile?: CharacterAiProfile;
  trait?: CharacterTrait;
  passiveId?: PassiveId;
  baseStats: CharacterStats;
  skillIds: string[];
}
