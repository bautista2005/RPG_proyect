import type { CharacterAiProfile, CharacterDefinition, CharacterStats } from "../domain/CharacterDefinition.js";
import type { CharacterTrait } from "../domain/CharacterTrait.js";
import type { PassiveId } from "../domain/PassiveDefinition.js";
import type { ActiveStatusEffect } from "../domain/StatusEffect.js";

/**
 * Representa a una unidad dentro del combate.
 * Esta estructura vive en runtime y se deriva de definiciones de dominio.
 */
export interface BattleUnit {
  unitId: string;
  teamId: string;
  characterId: string;
  name: string;
  role?: string;
  aiProfile: CharacterAiProfile;
  trait?: CharacterTrait;
  passiveId?: PassiveId;
  skillIds: string[];
  currentHp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  energy: number;
  isDefeated: boolean;
  statuses: ActiveStatusEffect[];
  cooldowns: Record<string, number>;
}

export interface BattleUnitSeed {
  unitId: string;
  teamId: string;
  character: CharacterDefinition;
  overrides?: Partial<CharacterStats>;
}

export function createBattleUnit(seed: BattleUnitSeed): BattleUnit {
  const stats = {
    ...seed.character.baseStats,
    ...seed.overrides,
  };

  return {
    unitId: seed.unitId,
    teamId: seed.teamId,
    characterId: seed.character.id,
    name: seed.character.name,
    role: seed.character.role,
    aiProfile: seed.character.aiProfile ?? "aggressive",
    trait: seed.character.trait,
    passiveId: seed.character.passiveId,
    skillIds: seed.character.skillIds,
    currentHp: stats.hp,
    maxHp: stats.hp,
    attack: stats.attack,
    defense: stats.defense,
    speed: stats.speed,
    energy: 0,
    isDefeated: false,
    statuses: [],
    cooldowns: {},
  };
}
