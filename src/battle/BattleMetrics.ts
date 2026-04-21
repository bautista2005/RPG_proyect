import type { BattleState } from "./BattleState.js";

export interface UnitCombatMetrics {
  unitId: string;
  characterId: string;
  name: string;
  teamId: string;
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
  shieldApplied: number;
  damageMitigated: number;
  actionsTaken: number;
  basicAttacks: number;
  skillUsage: Record<string, number>;
  wastedSupportActions: number;
  kills: number;
  survived: boolean;
  remainingHp: number;
}

export interface BattleMetrics {
  turnCount: number;
  winnerTeamId?: string;
  survivorsByTeam: Record<string, string[]>;
  unitMetrics: Record<string, UnitCombatMetrics>;
}

export function buildBattleMetrics(finalState: BattleState): BattleMetrics {
  const unitMetrics: Record<string, UnitCombatMetrics> = Object.fromEntries(
    Object.values(finalState.units).map((unit) => [
      unit.unitId,
      {
        unitId: unit.unitId,
        characterId: unit.characterId,
        name: unit.name,
        teamId: unit.teamId,
        damageDealt: 0,
        damageTaken: 0,
        healingDone: 0,
        shieldApplied: 0,
        damageMitigated: 0,
        actionsTaken: 0,
        basicAttacks: 0,
        skillUsage: {},
        wastedSupportActions: 0,
        kills: 0,
        survived: !unit.isDefeated,
        remainingHp: unit.currentHp,
      },
    ]),
  );

  for (const log of finalState.logs) {
    if (log.eventType === "action" && log.sourceUnitId && unitMetrics[log.sourceUnitId]) {
      const metrics = unitMetrics[log.sourceUnitId];

      metrics.actionsTaken += 1;

      if (log.detail === "basic_attack") {
        metrics.basicAttacks += 1;
      } else if (log.detail) {
        metrics.skillUsage[log.detail] = (metrics.skillUsage[log.detail] ?? 0) + 1;
      }
    }

    if (log.eventType === "damage" && log.sourceUnitId && unitMetrics[log.sourceUnitId]) {
      unitMetrics[log.sourceUnitId].damageDealt += log.value ?? 0;
    }

    if (log.eventType === "damage" && log.targetUnitId && unitMetrics[log.targetUnitId]) {
      unitMetrics[log.targetUnitId].damageTaken += log.value ?? 0;
    }

    if (log.eventType === "heal" && log.sourceUnitId && unitMetrics[log.sourceUnitId]) {
      unitMetrics[log.sourceUnitId].healingDone += log.value ?? 0;
    }

    if (
      log.eventType === "status" &&
      log.detail === "shield" &&
      log.sourceUnitId &&
      unitMetrics[log.sourceUnitId]
    ) {
      unitMetrics[log.sourceUnitId].shieldApplied += log.value ?? 0;
    }

    if (log.eventType === "mitigation" && log.sourceUnitId && unitMetrics[log.sourceUnitId]) {
      unitMetrics[log.sourceUnitId].damageMitigated += log.value ?? 0;
    }

    if (log.eventType === "support_waste" && log.sourceUnitId && unitMetrics[log.sourceUnitId]) {
      unitMetrics[log.sourceUnitId].wastedSupportActions += 1;
    }

    if (log.eventType === "defeat" && log.sourceUnitId && unitMetrics[log.sourceUnitId]) {
      unitMetrics[log.sourceUnitId].kills += 1;
    }
  }

  const survivorsByTeam = Object.values(finalState.units).reduce<Record<string, string[]>>((teams, unit) => {
    if (!teams[unit.teamId]) {
      teams[unit.teamId] = [];
    }

    if (!unit.isDefeated) {
      teams[unit.teamId].push(unit.unitId);
    }

    return teams;
  }, {});

  return {
    turnCount: finalState.turn,
    winnerTeamId: finalState.winnerTeamId,
    survivorsByTeam,
    unitMetrics,
  };
}
