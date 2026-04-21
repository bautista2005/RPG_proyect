import type { CharacterDefinition } from "../domain/CharacterDefinition.js";
import type { SkillDefinition, SkillTargetType } from "../domain/SkillDefinition.js";
import type { ActiveStatusEffect, StatusEffectDefinition } from "../domain/StatusEffect.js";
import { StatusEffectType } from "../domain/StatusEffect.js";
import type { BattleState } from "./BattleState.js";
import { createEmptyBattleState } from "./BattleState.js";
import type { BattleUnit, BattleUnitSeed } from "./BattleUnit.js";
import { createBattleUnit } from "./BattleUnit.js";

/**
 * Núcleo mínimo de combate por turnos para Battle Engine v2.
 * Los estados se procesan al inicio del turno de la unidad afectada.
 */
export interface BattleTeamDefinition {
  teamId: string;
  members: Array<{
    unitId: string;
    character: CharacterDefinition;
  }>;
}

export interface InitializeBattleInput {
  battleId: string;
  teams: [BattleTeamDefinition, BattleTeamDefinition];
  skills?: SkillDefinition[];
}

export function initializeBattle(input: InitializeBattleInput): BattleState {
  const seeds: BattleUnitSeed[] = input.teams.flatMap((team) =>
    team.members.map((member) => ({
      unitId: member.unitId,
      teamId: team.teamId,
      character: member.character,
    })),
  );

  const units = Object.fromEntries(seeds.map((seed) => [seed.unitId, createBattleUnit(seed)]));
  const unitOrder = sortUnitIdsByTurnOrder(Object.values(units));
  const currentUnitId = getNextActiveUnitId(unitOrder, units, null);

  const state: BattleState = {
    ...createEmptyBattleState(),
    battleId: input.battleId,
    turn: currentUnitId ? 1 : 0,
    currentUnitId,
    lifecycle: currentUnitId ? "in_progress" : "finished",
    unitOrder,
    skills: Object.fromEntries((input.skills ?? []).map((skill) => [skill.id, skill])),
    units,
    logs: [
      {
        turn: currentUnitId ? 1 : 0,
        message: `Battle initialized with ${unitOrder.length} units.`,
      },
    ],
  };

  return processTurnStartEffects(state);
}

export function getCurrentUnit(state: BattleState): BattleUnit | null {
  if (!state.currentUnitId) {
    return null;
  }

  return state.units[state.currentUnitId] ?? null;
}

export function canUnitAct(state: BattleState, unitId: string): boolean {
  const unit = state.units[unitId];

  if (!unit || unit.isDefeated) {
    return false;
  }

  return !unit.statuses.some((status) => status.type === StatusEffectType.Stun && status.remainingTurns > 0);
}

export function executeBasicAttack(
  state: BattleState,
  attackerUnitId: string,
  targetUnitId: string,
): BattleState {
  return executeDamageAction(state, attackerUnitId, targetUnitId, "Basic Attack");
}

export function executeSkill(
  state: BattleState,
  actorUnitId: string,
  skillId: string,
  targetUnitId: string,
): BattleState {
  const validationError = validateAction(state, actorUnitId, targetUnitId);

  if (validationError) {
    return appendLog(state, validationError, actorUnitId);
  }

  const actor = state.units[actorUnitId];
  const target = state.units[targetUnitId];
  const skill = state.skills[skillId];

  if (!skill || !actor.skillIds.includes(skillId)) {
    return appendLog(state, `${actor.name} cannot use skill ${skillId}.`, actorUnitId);
  }

  if (!isValidTarget(actor, target, skill.targetType)) {
    return appendLog(state, `${skill.name} cannot target ${target.name}.`, actorUnitId);
  }

  let nextState = appendLog(state, `${actor.name} uses ${skill.name} on ${target.name}.`, actorUnitId);

  if ((skill.kind === "damage" || skill.kind === "apply_status") && skill.power) {
    nextState = applyDamage(nextState, actorUnitId, targetUnitId, skill.power, skill.name);
  }

  const winnerAfterDamage = checkVictoryCondition(nextState);

  if (winnerAfterDamage) {
    return finalizeBattle(nextState, winnerAfterDamage);
  }

  if (skill.kind === "shield" && skill.shieldAmount) {
    nextState = applyStatusEffect(nextState, actorUnitId, targetUnitId, {
      type: StatusEffectType.Shield,
      durationTurns: skill.statusEffect?.durationTurns ?? 2,
      potency: skill.shieldAmount,
    });
  } else if (skill.statusEffect) {
    nextState = applyStatusEffect(nextState, actorUnitId, targetUnitId, skill.statusEffect);
  }

  const winnerTeamId = checkVictoryCondition(nextState);

  if (winnerTeamId) {
    return finalizeBattle(nextState, winnerTeamId);
  }

  return advanceTurn(nextState);
}

export function processTurnStartEffects(state: BattleState): BattleState {
  if (state.lifecycle !== "in_progress" || !state.currentUnitId) {
    return state;
  }

  const unit = state.units[state.currentUnitId];

  if (!unit || unit.isDefeated) {
    return finalizeOrAdvanceFromInactiveUnit(state);
  }

  let nextState = processPoisonEffects(state, unit);

  const refreshedUnit = nextState.units[unit.unitId];

  if (!refreshedUnit || refreshedUnit.isDefeated) {
    return finalizeOrAdvanceFromInactiveUnit(tickStatuses(nextState, unit.unitId));
  }

  const stunned = refreshedUnit.statuses.some(
    (status) => status.type === StatusEffectType.Stun && status.remainingTurns > 0,
  );

  nextState = tickStatuses(nextState, unit.unitId);

  if (stunned) {
    nextState = appendLog(nextState, `${refreshedUnit.name} is stunned and skips the turn.`, refreshedUnit.unitId);
    return advanceTurn(nextState);
  }

  return nextState;
}

export function applyDamage(
  state: BattleState,
  sourceUnitId: string | undefined,
  targetUnitId: string,
  power: number,
  reason: string,
  options?: {
    ignoreDefense?: boolean;
    logReasonAsEffect?: boolean;
  },
): BattleState {
  const target = state.units[targetUnitId];

  if (!target || target.isDefeated) {
    return state;
  }

  const totalDamage = calculateIncomingDamage(state, sourceUnitId, target, power, options);
  const shieldResult = absorbShieldDamage(state, target, totalDamage);
  const damageResult = resolveUnitDamage(target, shieldResult.statuses, shieldResult.remainingDamage);

  let nextState: BattleState = {
    ...shieldResult.state,
    units: {
      ...shieldResult.state.units,
      [target.unitId]: {
        ...target,
        currentHp: damageResult.nextHp,
        isDefeated: damageResult.defeated,
        statuses: shieldResult.statuses,
      },
    },
  };

  if (shieldResult.remainingDamage > 0 || options?.logReasonAsEffect) {
    const label = options?.logReasonAsEffect ? reason : `${reason} damage`;
    nextState = appendLog(
      nextState,
      `${target.name} takes ${shieldResult.remainingDamage} ${label}.`,
      target.unitId,
    );
  }

  return logDefeatIfNeeded(nextState, sourceUnitId, target.name, damageResult.defeated);
}

export function applyStatusEffect(
  state: BattleState,
  sourceUnitId: string,
  targetUnitId: string,
  effect: StatusEffectDefinition,
): BattleState {
  const target = state.units[targetUnitId];

  if (!target || target.isDefeated) {
    return state;
  }

  const nextEffect: ActiveStatusEffect = {
    ...effect,
    sourceUnitId,
    remainingTurns: effect.durationTurns,
  };

  const existingIndex = target.statuses.findIndex((status) => status.type === effect.type);
  const nextStatuses = [...target.statuses];

  if (existingIndex >= 0) {
    const current = nextStatuses[existingIndex];
    nextStatuses[existingIndex] = {
      ...current,
      remainingTurns: Math.max(current.remainingTurns, nextEffect.remainingTurns),
      potency:
        effect.type === StatusEffectType.Shield
          ? (current.potency ?? 0) + (nextEffect.potency ?? 0)
          : nextEffect.potency ?? current.potency,
      sourceUnitId,
    };
  } else {
    nextStatuses.push(nextEffect);
  }

  let nextState: BattleState = {
    ...state,
    units: {
      ...state.units,
      [target.unitId]: {
        ...target,
        statuses: nextStatuses,
      },
    },
  };

  if (effect.type === StatusEffectType.Poison) {
    nextState = appendLog(nextState, `${target.name} is poisoned for ${effect.durationTurns} turns.`, sourceUnitId);
  } else if (effect.type === StatusEffectType.Stun) {
    nextState = appendLog(nextState, `${target.name} is stunned for ${effect.durationTurns} turns.`, sourceUnitId);
  } else if (effect.type === StatusEffectType.Shield) {
    nextState = appendLog(nextState, `${target.name} gains ${effect.potency ?? 0} shield.`, sourceUnitId);
  }

  return nextState;
}

export function checkVictoryCondition(state: BattleState): string | undefined {
  const aliveTeamIds = new Set(
    Object.values(state.units)
      .filter((unit) => !unit.isDefeated)
      .map((unit) => unit.teamId),
  );

  if (aliveTeamIds.size === 1) {
    return [...aliveTeamIds][0];
  }

  return undefined;
}

export function advanceTurn(state: BattleState): BattleState {
  if (state.lifecycle !== "in_progress") {
    return state;
  }

  const winnerTeamId = checkVictoryCondition(state);

  if (winnerTeamId) {
    return finalizeBattle(state, winnerTeamId);
  }

  const nextUnitId = getNextActiveUnitId(state.unitOrder, state.units, state.currentUnitId);

  if (!nextUnitId) {
    return {
      ...state,
      lifecycle: "finished",
      currentUnitId: null,
    };
  }

  return processTurnStartEffects({
    ...state,
    turn: state.turn + 1,
    currentUnitId: nextUnitId,
  });
}

export function sortUnitIdsByTurnOrder(units: Array<{ unitId: string; speed: number }>): string[] {
  return [...units]
    .sort((left, right) => {
      if (right.speed !== left.speed) {
        return right.speed - left.speed;
      }

      return left.unitId.localeCompare(right.unitId);
    })
    .map((unit) => unit.unitId);
}

function executeDamageAction(
  state: BattleState,
  attackerUnitId: string,
  targetUnitId: string,
  actionName: string,
): BattleState {
  const validationError = validateAction(state, attackerUnitId, targetUnitId);

  if (validationError) {
    return appendLog(state, validationError, attackerUnitId);
  }

  const attacker = state.units[attackerUnitId];
  const target = state.units[targetUnitId];

  if (!isValidTarget(attacker, target, "enemy")) {
    return appendLog(state, `${actionName} cannot target ${target.name}.`, attackerUnitId);
  }

  let nextState = appendLog(state, `${attacker.name} uses ${actionName} on ${target.name}.`, attacker.unitId);
  nextState = applyDamage(nextState, attacker.unitId, target.unitId, 0, actionName);

  const winnerTeamId = checkVictoryCondition(nextState);

  if (winnerTeamId) {
    return finalizeBattle(nextState, winnerTeamId);
  }

  return advanceTurn(nextState);
}

function validateAction(state: BattleState, actorUnitId: string, targetUnitId: string): string | null {
  if (state.lifecycle !== "in_progress") {
    return "Action skipped because battle is not in progress.";
  }

  if (state.currentUnitId !== actorUnitId) {
    return `Action skipped because it is not ${actorUnitId}'s turn.`;
  }

  const actor = state.units[actorUnitId];
  const target = state.units[targetUnitId];

  if (!actor || !target || actor.isDefeated || target.isDefeated) {
    return "Action skipped because actor or target is invalid.";
  }

  if (!canUnitAct(state, actorUnitId)) {
    return `${actor.name} cannot act this turn.`;
  }

  return null;
}

function processPoisonEffects(state: BattleState, unit: BattleUnit): BattleState {
  let nextState = state;
  const poisonEffects = unit.statuses.filter(
    (status) => status.type === StatusEffectType.Poison && status.remainingTurns > 0,
  );

  for (const effect of poisonEffects) {
    nextState = applyDamage(nextState, effect.sourceUnitId, unit.unitId, effect.potency ?? 0, "poison damage", {
      ignoreDefense: true,
      logReasonAsEffect: true,
    });

    const winnerTeamId = checkVictoryCondition(nextState);

    if (winnerTeamId) {
      return finalizeBattle(tickStatuses(nextState, unit.unitId), winnerTeamId);
    }
  }

  return nextState;
}

function isValidTarget(actor: BattleUnit, target: BattleUnit, targetType: SkillTargetType): boolean {
  if (targetType === "self") {
    return actor.unitId === target.unitId;
  }

  if (targetType === "ally") {
    return actor.teamId === target.teamId;
  }

  return actor.teamId !== target.teamId;
}

function calculateIncomingDamage(
  state: BattleState,
  sourceUnitId: string | undefined,
  target: BattleUnit,
  power: number,
  options?: {
    ignoreDefense?: boolean;
    logReasonAsEffect?: boolean;
  },
): number {
  const source = sourceUnitId ? state.units[sourceUnitId] : undefined;

  if (options?.ignoreDefense) {
    return power;
  }

  return Math.max(1, (source?.attack ?? 0) + power - target.defense);
}

function absorbShieldDamage(
  state: BattleState,
  target: BattleUnit,
  incomingDamage: number,
): {
  state: BattleState;
  statuses: ActiveStatusEffect[];
  remainingDamage: number;
} {
  let remainingDamage = incomingDamage;
  let nextStatuses = [...target.statuses];
  let nextState = state;

  const shieldIndex = nextStatuses.findIndex(
    (status) => status.type === StatusEffectType.Shield && (status.potency ?? 0) > 0,
  );

  if (shieldIndex < 0) {
    return {
      state: nextState,
      statuses: nextStatuses,
      remainingDamage,
    };
  }

  const shield = nextStatuses[shieldIndex];
  const absorbed = Math.min(remainingDamage, shield.potency ?? 0);

  remainingDamage -= absorbed;
  nextStatuses[shieldIndex] = {
    ...shield,
    potency: (shield.potency ?? 0) - absorbed,
  };
  nextState = appendLog(nextState, `${target.name}'s shield absorbed ${absorbed} damage.`, target.unitId);

  if ((nextStatuses[shieldIndex].potency ?? 0) <= 0) {
    nextStatuses = nextStatuses.filter((_, index) => index !== shieldIndex);
    nextState = appendLog(nextState, `${target.name}'s shield was depleted.`, target.unitId);
  }

  return {
    state: nextState,
    statuses: nextStatuses,
    remainingDamage,
  };
}

function resolveUnitDamage(
  target: BattleUnit,
  statuses: ActiveStatusEffect[],
  remainingDamage: number,
): {
  nextHp: number;
  defeated: boolean;
  statuses: ActiveStatusEffect[];
} {
  const nextHp = Math.max(0, target.currentHp - remainingDamage);

  return {
    nextHp,
    defeated: nextHp <= 0,
    statuses,
  };
}

function logDefeatIfNeeded(
  state: BattleState,
  sourceUnitId: string | undefined,
  targetName: string,
  defeated: boolean,
): BattleState {
  if (!defeated) {
    return state;
  }

  return appendLog(state, `${targetName} was defeated.`, sourceUnitId);
}

function tickStatuses(state: BattleState, unitId: string): BattleState {
  const unit = state.units[unitId];

  if (!unit) {
    return state;
  }

  const nextStatuses = unit.statuses
    .map((status) => ({
      ...status,
      remainingTurns: status.remainingTurns - 1,
    }))
    .filter((status) => {
      if (status.type === StatusEffectType.Shield) {
        return status.remainingTurns > 0 && (status.potency ?? 0) > 0;
      }

      return status.remainingTurns > 0;
    });

  return {
    ...state,
    units: {
      ...state.units,
      [unitId]: {
        ...unit,
        statuses: nextStatuses,
      },
    },
  };
}

function getNextActiveUnitId(
  unitOrder: string[],
  units: BattleState["units"],
  currentUnitId: string | null,
): string | null {
  const aliveUnitIds = unitOrder.filter((unitId) => !units[unitId]?.isDefeated);

  if (aliveUnitIds.length === 0) {
    return null;
  }

  if (!currentUnitId) {
    return aliveUnitIds[0];
  }

  const currentIndex = unitOrder.indexOf(currentUnitId);

  for (let offset = 1; offset <= unitOrder.length; offset += 1) {
    const candidateId = unitOrder[(currentIndex + offset) % unitOrder.length];

    if (candidateId && !units[candidateId]?.isDefeated) {
      return candidateId;
    }
  }

  return null;
}

function finalizeOrAdvanceFromInactiveUnit(state: BattleState): BattleState {
  const winnerTeamId = checkVictoryCondition(state);

  if (winnerTeamId) {
    return finalizeBattle(state, winnerTeamId);
  }

  return advanceTurn(state);
}

function finalizeBattle(state: BattleState, winnerTeamId: string): BattleState {
  if (state.lifecycle === "finished" && state.winnerTeamId === winnerTeamId) {
    return state;
  }

  return {
    ...state,
    lifecycle: "finished",
    currentUnitId: null,
    winnerTeamId,
    logs: [
      ...state.logs,
      {
        turn: state.turn,
        message: `Team ${winnerTeamId} wins the battle.`,
      },
    ],
  };
}

function appendLog(state: BattleState, message: string, actorUnitId?: string): BattleState {
  return {
    ...state,
    logs: [
      ...state.logs,
      {
        turn: state.turn,
        actorUnitId,
        message,
      },
    ],
  };
}
