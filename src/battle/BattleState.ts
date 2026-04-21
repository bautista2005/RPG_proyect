import type { SkillDefinition } from "../domain/SkillDefinition.js";
import type { BattleUnit } from "./BattleUnit.js";

/**
 * Estado raíz del combate.
 * Debe poder serializarse y ser independiente de cualquier framework de UI.
 */
export type BattleLifecycle = "setup" | "in_progress" | "finished";

export interface BattleLogEntry {
  turn: number;
  message: string;
  actorUnitId?: string;
}

export interface BattleState {
  battleId: string;
  turn: number;
  currentUnitId: string | null;
  lifecycle: BattleLifecycle;
  unitOrder: string[];
  skills: Record<string, SkillDefinition>;
  units: Record<string, BattleUnit>;
  logs: BattleLogEntry[];
  winnerTeamId?: string;
}

export function createEmptyBattleState(): BattleState {
  return {
    battleId: "pending-battle",
    turn: 0,
    currentUnitId: null,
    lifecycle: "setup",
    unitOrder: [],
    skills: {},
    units: {},
    logs: [],
  };
}
