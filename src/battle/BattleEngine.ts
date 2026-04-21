import type { BattleAction } from "./BattleAction.js";
import type { CharacterDefinition } from "../domain/CharacterDefinition.js";
import type { SkillDefinition, SkillTargetType } from "../domain/SkillDefinition.js";
import type { ActiveStatusEffect, StatusEffectDefinition } from "../domain/StatusEffect.js";
import { StatusEffectType } from "../domain/StatusEffect.js";
import { getPassiveDefinition } from "../data/passives.js";
import type { BattleLogEntry, BattleState } from "./BattleState.js";
import { createEmptyBattleState } from "./BattleState.js";
import { createBattleRandomState, deterministicTieBreak, rollRandom } from "./BattleRandom.js";
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
  seed?: number;
}

export interface BattleActionValidationResult {
  isValid: boolean;
  reason?: string;
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
  const random = createBattleRandomState(input.seed);
  const unitOrder = sortUnitIdsByTurnOrder(Object.values(units), random.initialSeed);
  const currentUnitId = getNextActiveUnitId(unitOrder, units, null);

  const state: BattleState = {
    ...createEmptyBattleState(),
    battleId: input.battleId,
    turn: currentUnitId ? 1 : 0,
    currentUnitId,
    lifecycle: currentUnitId ? "in_progress" : "finished",
    random,
    unitOrder,
    skills: Object.fromEntries((input.skills ?? []).map((skill) => [skill.id, skill])),
    units,
    logs: [
      {
        turn: currentUnitId ? 1 : 0,
        message: `Battle initialized with ${unitOrder.length} units.`,
        eventType: "battle_start",
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
  const validationError = validateActionContext(state, actorUnitId, targetUnitId);

  if (validationError) {
    return appendLog(state, validationError, actorUnitId);
  }

  const actor = state.units[actorUnitId];
  const target = state.units[targetUnitId];
  const skill = state.skills[skillId];

  if (!skill || !actor.skillIds.includes(skillId)) {
    return appendLog(state, `${actor.name} cannot use skill ${skillId}.`, actorUnitId);
  }

  const availabilityError = validateSkillAvailability(actor, skill);

  if (availabilityError) {
    return appendLog(state, availabilityError, actorUnitId);
  }

  if (!isValidTarget(actor, target, skill.targetType)) {
    return appendLog(state, `${skill.name} cannot target ${target.name}.`, actorUnitId);
  }

  let nextState = appendLog(state, `${actor.name} uses ${skill.name} on ${target.name}.`, actorUnitId, {
    eventType: "action",
    sourceUnitId: actorUnitId,
    targetUnitId,
    detail: skill.id,
  });
  nextState = spendEnergyAndSetCooldown(nextState, actorUnitId, skill);

  if ((skill.kind === "damage" || skill.kind === "apply_status") && skill.power) {
    nextState = applyDamage(nextState, actorUnitId, targetUnitId, skill.power, skill.name);
    nextState = applySkillPressureDamage(nextState, actor, targetUnitId, skill);
  }

  if (skill.kind === "heal" && skill.power) {
    nextState = applyHeal(nextState, actorUnitId, targetUnitId, skill.power, skill.name);
  }

  const winnerAfterDamage = checkVictoryCondition(nextState);

  if (winnerAfterDamage) {
    return finalizeBattle(nextState, winnerAfterDamage);
  }

  if (skill.kind === "shield") {
    const shieldEffect = resolveShieldEffect(skill);

    if (shieldEffect) {
      nextState = applyStatusEffect(nextState, actorUnitId, targetUnitId, shieldEffect);
    }
  } else if (skill.statusEffect) {
    nextState = applyStatusEffect(nextState, actorUnitId, targetUnitId, skill.statusEffect);
  }

  const winnerTeamId = checkVictoryCondition(nextState);

  if (winnerTeamId) {
    return finalizeBattle(nextState, winnerTeamId);
  }

  return advanceTurn(nextState);
}

export function validateAction(state: BattleState, action: BattleAction): BattleActionValidationResult {
  const contextError = validateActionContext(state, action.actorId, action.targetId);

  if (contextError) {
    return {
      isValid: false,
      reason: contextError,
    };
  }

  const actor = state.units[action.actorId];
  const target = state.units[action.targetId];

  if (action.actionType === "basic_attack") {
    if (!isValidTarget(actor, target, "enemy")) {
      return {
        isValid: false,
        reason: `Basic Attack cannot target ${target.name}.`,
      };
    }

    return {
      isValid: true,
    };
  }

  if (!action.skillId) {
    return {
      isValid: false,
      reason: "Skill action skipped because skillId is missing.",
    };
  }

  const skill = state.skills[action.skillId];

  if (!skill || !actor.skillIds.includes(action.skillId)) {
    return {
      isValid: false,
      reason: `${actor.name} cannot use skill ${action.skillId}.`,
    };
  }

  const availabilityError = validateSkillAvailability(actor, skill);

  if (availabilityError) {
    return {
      isValid: false,
      reason: availabilityError,
    };
  }

  if (!isValidTarget(actor, target, skill.targetType)) {
    return {
      isValid: false,
      reason: `${skill.name} cannot target ${target.name}.`,
    };
  }

  return {
    isValid: true,
  };
}

export function executeAction(state: BattleState, action: BattleAction): BattleState {
  const validation = validateAction(state, action);

  if (!validation.isValid) {
    const prefix = action.source === "manual" ? "Manual action rejected" : "Action rejected";
    return addBattleLog(state, `${prefix}: ${validation.reason ?? "invalid action"}.`, action.actorId, {
      eventType: "validation",
      sourceUnitId: action.actorId,
      targetUnitId: action.targetId,
      detail: action.actionType,
    });
  }

  const stateWithDecisionLog = action.decisionNote
    ? addBattleLog(state, action.decisionNote, action.actorId, {
        eventType: "decision",
        sourceUnitId: action.actorId,
        targetUnitId: action.targetId,
        detail: action.actionType === "skill" ? action.skillId : action.actionType,
      })
    : state;

  if (action.actionType === "skill" && action.skillId) {
    return executeSkill(stateWithDecisionLog, action.actorId, action.skillId, action.targetId);
  }

  return executeBasicAttack(stateWithDecisionLog, action.actorId, action.targetId);
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
  nextState = tickCooldowns(nextState, unit.unitId);

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
    disableVariance?: boolean;
  },
): BattleState {
  const target = state.units[targetUnitId];

  if (!target || target.isDefeated) {
    return state;
  }

  let nextState = state;
  const source = sourceUnitId ? state.units[sourceUnitId] : undefined;
  const outgoingModifier = resolveOutgoingDamageModifier(source, target, options);
  const totalDamage = calculateIncomingDamage(state, sourceUnitId, target, power + outgoingModifier, options);
  const [stateAfterVariance, variedDamage] = applyDamageVariance(
    nextState,
    totalDamage,
    (options?.disableVariance ?? false) || options?.ignoreDefense === true || options?.logReasonAsEffect === true,
  );
  nextState = stateAfterVariance;
  const incomingReduction = resolveIncomingDamageReduction(target, variedDamage);
  const finalDamage = Math.max(0, variedDamage - incomingReduction);

  if (outgoingModifier > 0 && source) {
    nextState = appendLog(
      nextState,
      `${source.name} passive ${getPassiveDefinition(source.passiveId)?.name ?? source.passiveId} adds ${outgoingModifier} damage against ${target.name}.`,
      source.unitId,
    );
  }

  if (incomingReduction > 0) {
    nextState = appendLog(
      nextState,
      `${target.name} passive ${getPassiveDefinition(target.passiveId)?.name ?? target.passiveId} reduces incoming damage by ${incomingReduction}.`,
      target.unitId,
      {
        eventType: "mitigation",
        sourceUnitId: target.unitId,
        targetUnitId: target.unitId,
        value: incomingReduction,
        detail: target.passiveId ?? "passive",
      },
    );
  }

  const shieldResult = absorbShieldDamage(nextState, target, finalDamage);
  const damageResult = resolveUnitDamage(target, shieldResult.statuses, shieldResult.remainingDamage);
  const actualDamage = Math.max(0, target.currentHp - damageResult.nextHp);

  nextState = {
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
      {
        eventType: "damage",
        sourceUnitId,
        targetUnitId,
        value: actualDamage,
        detail: reason,
      },
    );
  }

  nextState = logDefeatIfNeeded(nextState, sourceUnitId, target.unitId, target.name, damageResult.defeated);

  if (damageResult.defeated && source) {
    nextState = resolveOnKillPassive(nextState, source.unitId);
  }

  return nextState;
}

export function applyHeal(
  state: BattleState,
  sourceUnitId: string,
  targetUnitId: string,
  power: number,
  reason: string,
): BattleState {
  const target = state.units[targetUnitId];

  if (!target || target.isDefeated) {
    return state;
  }

  const healedAmount = Math.max(0, Math.min(power, target.maxHp - target.currentHp));
  const nextHp = Math.min(target.maxHp, target.currentHp + power);

  let nextState = {
    ...state,
    units: {
      ...state.units,
      [target.unitId]: {
        ...target,
        currentHp: nextHp,
      },
    },
  };

  nextState = appendLog(
    nextState,
    `${target.name} recovers ${healedAmount} HP from ${reason}.`,
    sourceUnitId,
    {
      eventType: "heal",
      sourceUnitId,
      targetUnitId,
      value: healedAmount,
      detail: reason,
    },
  );

  if (healedAmount <= 0) {
    nextState = appendLog(
      nextState,
      `${reason} had no effect on ${target.name}.`,
      sourceUnitId,
      {
        eventType: "support_waste",
        sourceUnitId,
        targetUnitId,
        detail: reason,
      },
    );
  }

  return nextState;
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
    nextState = appendLog(nextState, `${target.name} is poisoned for ${effect.durationTurns} turns.`, sourceUnitId, {
      eventType: "status",
      sourceUnitId,
      targetUnitId,
      detail: StatusEffectType.Poison,
    });
  } else if (effect.type === StatusEffectType.Stun) {
    nextState = appendLog(nextState, `${target.name} is stunned for ${effect.durationTurns} turns.`, sourceUnitId, {
      eventType: "status",
      sourceUnitId,
      targetUnitId,
      detail: StatusEffectType.Stun,
    });
  } else if (effect.type === StatusEffectType.Shield) {
    nextState = appendLog(nextState, `${target.name} gains ${effect.potency ?? 0} shield.`, sourceUnitId, {
      eventType: "status",
      sourceUnitId,
      targetUnitId,
      value: effect.potency ?? 0,
      detail: StatusEffectType.Shield,
    });

    const hadShield = existingIndex >= 0;
    const isLowImpactShield = !hadShield && target.currentHp === target.maxHp;

    if (hadShield || isLowImpactShield) {
      nextState = appendLog(
        nextState,
        `${effect.type} on ${target.name} had limited immediate impact.`,
        sourceUnitId,
        {
          eventType: "support_waste",
          sourceUnitId,
          targetUnitId,
          detail: StatusEffectType.Shield,
        },
      );
    }
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

export function sortUnitIdsByTurnOrder(units: Array<{ unitId: string; speed: number }>, seed = 0): string[] {
  return [...units]
    .sort((left, right) => {
      if (right.speed !== left.speed) {
        return right.speed - left.speed;
      }

      const tieBreak =
        deterministicTieBreak(seed, left.unitId, right.unitId) -
        deterministicTieBreak(seed, right.unitId, left.unitId);

      if (tieBreak !== 0) {
        return tieBreak;
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
  const validationError = validateActionContext(state, attackerUnitId, targetUnitId);

  if (validationError) {
    return appendLog(state, validationError, attackerUnitId);
  }

  const attacker = state.units[attackerUnitId];
  const target = state.units[targetUnitId];

  if (!isValidTarget(attacker, target, "enemy")) {
    return appendLog(state, `${actionName} cannot target ${target.name}.`, attackerUnitId);
  }

  let nextState = appendLog(state, `${attacker.name} uses ${actionName} on ${target.name}.`, attacker.unitId, {
    eventType: "action",
    sourceUnitId: attacker.unitId,
    targetUnitId: target.unitId,
    detail: "basic_attack",
  });
  nextState = applyDamage(nextState, attacker.unitId, target.unitId, 0, actionName);
  nextState = gainEnergyFromBasicAttack(nextState, attacker.unitId);

  const winnerTeamId = checkVictoryCondition(nextState);

  if (winnerTeamId) {
    return finalizeBattle(nextState, winnerTeamId);
  }

  return advanceTurn(nextState);
}

function validateActionContext(state: BattleState, actorUnitId: string, targetUnitId: string): string | null {
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

function validateSkillAvailability(actor: BattleUnit, skill: SkillDefinition): string | null {
  const currentCooldown = actor.cooldowns[skill.id] ?? 0;

  if (currentCooldown > 0) {
    return `${actor.name} cannot use ${skill.name} because it is on cooldown for ${currentCooldown} more turns.`;
  }

  const energyCost = skill.energyCost ?? 0;

  if (actor.energy < energyCost) {
    return `${actor.name} cannot use ${skill.name} because they need ${energyCost} energy.`;
  }

  return null;
}

function resolveShieldEffect(skill: SkillDefinition): StatusEffectDefinition | null {
  if (skill.statusEffect?.type === StatusEffectType.Shield) {
    return skill.statusEffect;
  }

  if (skill.shieldAmount) {
    return {
      type: StatusEffectType.Shield,
      durationTurns: 2,
      potency: skill.shieldAmount,
    };
  }

  return null;
}

function applySkillPressureDamage(
  state: BattleState,
  actor: BattleUnit,
  targetUnitId: string,
  skill: SkillDefinition,
): BattleState {
  if (skill.id !== "tyrant-rush") {
    return state;
  }

  const target = state.units[targetUnitId];

  if (!target || target.isDefeated) {
    return state;
  }

  let bonusDamage = 0;

  if (target.role === "support" || target.role === "controller") {
    bonusDamage += 3;
  }

  if (hasStatus(target, StatusEffectType.Shield)) {
    bonusDamage += 2;
  }

  if (state.turn >= 8) {
    bonusDamage += 2;
  }

  if (bonusDamage <= 0) {
    return state;
  }

  return applyDamage(state, actor.unitId, target.unitId, bonusDamage, `${skill.name} pressure`, {
    ignoreDefense: true,
    disableVariance: true,
  });
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
      disableVariance: true,
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

function applyDamageVariance(
  state: BattleState,
  damage: number,
  disabled: boolean,
): [BattleState, number] {
  if (disabled || damage <= 1) {
    return [state, damage];
  }

  const [nextState, roll] = rollRandom(state);
  const modifier = roll < 1 / 3 ? -1 : roll < 2 / 3 ? 0 : 1;

  return [nextState, Math.max(1, damage + modifier)];
}

function resolveOutgoingDamageModifier(
  source: BattleUnit | undefined,
  target: BattleUnit,
  options?: {
    ignoreDefense?: boolean;
    logReasonAsEffect?: boolean;
  },
): number {
  if (!source || options?.logReasonAsEffect) {
    return 0;
  }

  if (source.passiveId === "bonus_damage_vs_poisoned" && hasStatus(target, StatusEffectType.Poison)) {
    return 2;
  }

  return 0;
}

function resolveIncomingDamageReduction(target: BattleUnit, totalDamage: number): number {
  if (target.passiveId !== "reduce_incoming_damage_flat" || totalDamage <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, totalDamage - 1));
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
  nextState = appendLog(nextState, `${target.name}'s shield absorbed ${absorbed} damage.`, target.unitId, {
    eventType: "mitigation",
    sourceUnitId: shield.sourceUnitId ?? target.unitId,
    targetUnitId: target.unitId,
    value: absorbed,
    detail: StatusEffectType.Shield,
  });

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
  targetUnitId: string,
  targetName: string,
  defeated: boolean,
): BattleState {
  if (!defeated) {
    return state;
  }

  return appendLog(state, `${targetName} was defeated.`, sourceUnitId, {
    eventType: "defeat",
    sourceUnitId,
    targetUnitId,
  });
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

function tickCooldowns(state: BattleState, unitId: string): BattleState {
  const unit = state.units[unitId];

  if (!unit) {
    return state;
  }

  const nextCooldowns = Object.fromEntries(
    Object.entries(unit.cooldowns)
      .map(([skillId, turns]) => [skillId, turns - 1] as const)
      .filter(([, turns]) => turns > 0),
  );

  return {
    ...state,
    units: {
      ...state.units,
      [unitId]: {
        ...unit,
        cooldowns: nextCooldowns,
      },
    },
  };
}

function spendEnergyAndSetCooldown(
  state: BattleState,
  actorUnitId: string,
  skill: SkillDefinition,
): BattleState {
  const actor = state.units[actorUnitId];

  if (!actor) {
    return state;
  }

  const energyCost = skill.energyCost ?? 0;
  const cooldownTurns = skill.cooldownTurns ?? 0;

  return {
    ...state,
    units: {
      ...state.units,
      [actorUnitId]: {
        ...actor,
        energy: actor.energy - energyCost,
        cooldowns:
          cooldownTurns > 0
            ? {
                ...actor.cooldowns,
                [skill.id]: cooldownTurns,
              }
            : actor.cooldowns,
      },
    },
  };
}

function gainEnergy(state: BattleState, unitId: string, amount: number): BattleState {
  if (amount <= 0) {
    return state;
  }

  const unit = state.units[unitId];

  if (!unit) {
    return state;
  }

  return {
    ...state,
    units: {
      ...state.units,
      [unitId]: {
        ...unit,
        energy: unit.energy + amount,
      },
    },
  };
}

function gainEnergyFromBasicAttack(state: BattleState, unitId: string): BattleState {
  const unit = state.units[unitId];

  if (!unit) {
    return state;
  }

  const amount = unit.passiveId === "gain_extra_energy_on_basic" ? 2 : 1;
  const nextState = gainEnergy(state, unitId, amount);

  if (amount > 1) {
    return appendLog(
      nextState,
      `${unit.name} passive ${getPassiveDefinition(unit.passiveId)?.name ?? unit.passiveId} grants +1 extra energy on Basic Attack.`,
      unit.unitId,
      {
        eventType: "passive",
        sourceUnitId: unit.unitId,
        value: amount - 1,
        detail: unit.passiveId,
      },
    );
  }

  return nextState;
}

function resolveOnKillPassive(state: BattleState, unitId: string): BattleState {
  const unit = state.units[unitId];

  if (!unit || unit.passiveId !== "heal_small_on_kill" || unit.isDefeated) {
    return state;
  }

  const healAmount = Math.min(3, unit.maxHp - unit.currentHp);

  if (healAmount <= 0) {
    return state;
  }

  const nextState: BattleState = {
    ...state,
    units: {
      ...state.units,
      [unitId]: {
        ...unit,
        currentHp: unit.currentHp + healAmount,
      },
    },
  };

  return appendLog(
    nextState,
    `${unit.name} passive ${getPassiveDefinition(unit.passiveId)?.name ?? unit.passiveId} restores ${healAmount} HP on kill.`,
    unit.unitId,
    {
      eventType: "passive",
      sourceUnitId: unit.unitId,
      value: healAmount,
      detail: unit.passiveId,
    },
  );
}

function hasStatus(unit: BattleUnit, effectType: StatusEffectType): boolean {
  return unit.statuses.some((status) => status.type === effectType && status.remainingTurns > 0);
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
        eventType: "battle_end",
      },
    ],
  };
}

function appendLog(
  state: BattleState,
  message: string,
  actorUnitId?: string,
  metadata?: Partial<BattleLogEntry>,
): BattleState {
  return {
    ...state,
    logs: [
      ...state.logs,
      {
        turn: state.turn,
        actorUnitId,
        message,
        ...metadata,
      },
    ],
  };
}

export function addBattleLog(
  state: BattleState,
  message: string,
  actorUnitId?: string,
  metadata?: Partial<BattleLogEntry>,
): BattleState {
  return appendLog(state, message, actorUnitId, metadata);
}
