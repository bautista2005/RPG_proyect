import type { SkillDefinition } from "../domain/SkillDefinition.js";
import type { BattleUnit } from "./BattleUnit.js";
import { createBattleRandomState, type BattleRandomState } from "./BattleRandom.js";

/**
 * Estado raíz del combate.
 * Debe poder serializarse y ser independiente de cualquier framework de UI.
 */
export type BattleLifecycle = "setup" | "in_progress" | "finished";
export type BattleLogEventType =
  | "battle_start"
  | "battle_end"
  | "decision"
  | "action"
  | "damage"
  | "heal"
  | "defeat"
  | "validation"
  | "status"
  | "passive"
  | "mitigation"
  | "support_waste";

export interface BattleLogEntry {
  turn: number;
  message: string;
  actorUnitId?: string;
  eventType?: BattleLogEventType;
  sourceUnitId?: string;
  targetUnitId?: string;
  value?: number;
  detail?: string;
}

export interface BattleState {
  battleId: string;
  turn: number;
  currentUnitId: string | null;
  lifecycle: BattleLifecycle;
  random: BattleRandomState;
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
    random: createBattleRandomState(),
    unitOrder: [],
    skills: {},
    units: {},
    logs: [],
  };
}
