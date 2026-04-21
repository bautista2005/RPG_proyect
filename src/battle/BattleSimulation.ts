import { addBattleLog, advanceTurn, canUnitAct, executeAction as executeResolvedAction, validateAction } from "./BattleEngine.js";
import { deterministicTieBreak } from "./BattleRandom.js";
import { buildBattleMetrics, type BattleMetrics } from "./BattleMetrics.js";
import type { BattleState } from "./BattleState.js";
import type { BattleUnit } from "./BattleUnit.js";
import type { BattleAction } from "./BattleAction.js";
import type { SkillDefinition } from "../domain/SkillDefinition.js";
import { StatusEffectType } from "../domain/StatusEffect.js";
import { createBattleStateFromScenario, isBattleScenario, type BattleScenario } from "../game/BattleScenario.js";

export const MAX_TURNS = 500;
const VULNERABLE_HP_RATIO = 0.75;
const CRITICAL_HP_RATIO = 0.45;
const HEAL_TRIGGER_HP_RATIO = 0.7;
const MIN_MEANINGFUL_HEAL = 5;
const SHIELD_THREAT_BUFFER = 2;
const SUPPORT_SELF_PRESERVE_HP_RATIO = 0.72;
const BACKLINE_HEAL_TRIGGER_HP_RATIO = 0.82;

export interface BattleSimulationOptions {
  maxTurns?: number;
  seed?: number;
}

export interface BattleSimulationResult {
  finalState: BattleState;
  logs: BattleState["logs"];
  metrics: BattleMetrics;
  executedActions: number;
  abortedDueToTurnLimit: boolean;
  scenarioId?: string;
}

export function decideAction(state: BattleState, unitId: string): BattleAction {
  const actor = state.units[unitId];

  if (!actor || actor.isDefeated) {
    throw new Error(`Cannot decide action for invalid unit ${unitId}.`);
  }

  const usableSkills = getUsableSkills(state, actor);
  const protectorAction = actor.trait === "protector" ? decideProtectorAction(state, actor, usableSkills) : null;

  if (protectorAction) {
    return protectorAction;
  }

  if (actor.role === "boss") {
    return decideBossAction(state, actor, usableSkills) ?? createBasicAttackAction(actor, state);
  }

  if (actor.aiProfile === "supportive") {
    return decideSupportiveAction(state, actor, usableSkills) ?? createBasicAttackAction(actor, state);
  }

  if (actor.aiProfile === "defensive") {
    return decideDefensiveAction(state, actor, usableSkills) ?? createBasicAttackAction(actor, state);
  }

  if (actor.aiProfile === "control") {
    return decideControlAction(state, actor, usableSkills) ?? createBasicAttackAction(actor, state);
  }

  return decideAggressiveAction(state, actor, usableSkills) ?? createBasicAttackAction(actor, state);
}

export function executeAction(state: BattleState, action: BattleAction): BattleState {
  return executeResolvedAction(state, action);
}

export function simulateBattle(
  input: BattleState | BattleScenario,
  options: BattleSimulationOptions = {},
): BattleSimulationResult {
  const scenario = isBattleScenario(input) ? input : undefined;
  const maxTurns = options.maxTurns ?? scenario?.config?.maxTurns ?? MAX_TURNS;
  const scenarioWithOverrides =
    scenario && options.seed !== undefined
      ? {
          ...scenario,
          config: {
            ...scenario.config,
            seed: options.seed,
          },
        }
      : scenario;
  let state: BattleState = scenarioWithOverrides ? createBattleStateFromScenario(scenarioWithOverrides) : (input as BattleState);
  let executedActions = 0;
  let abortedDueToTurnLimit = false;

  while (state.lifecycle === "in_progress" && executedActions < maxTurns) {
    const actorId = state.currentUnitId;

    if (!actorId) {
      break;
    }

    const actor = state.units[actorId];

    if (!actor || actor.isDefeated || !canUnitAct(state, actorId)) {
      state = advanceTurn(state);
      continue;
    }

    const action = decideAction(state, actorId);
    state = executeAction(
      addBattleLog(state, `${actor.name} chooses ${describeAction(state, action)}.`, actorId, {
        eventType: "decision",
        sourceUnitId: actorId,
        targetUnitId: action.targetId,
        detail: describeAction(state, action),
      }),
      action,
    );
    executedActions += 1;
  }

  if (state.lifecycle === "in_progress") {
    abortedDueToTurnLimit = true;
    state = {
      ...state,
      lifecycle: "finished",
      currentUnitId: null,
      logs: [
        ...state.logs,
        {
          turn: state.turn,
          message: `Battle simulation stopped after reaching the safety limit of ${maxTurns} turns.`,
        },
      ],
    };
  }

  return {
    finalState: state,
    logs: state.logs,
    metrics: buildBattleMetrics(state),
    executedActions,
    abortedDueToTurnLimit,
    scenarioId: scenario?.id,
  };
}

export function selectSkillTarget(
  state: BattleState,
  actor: BattleUnit,
  skill: SkillDefinition,
): BattleUnit | null {
  if (skill.targetType === "self") {
    return actor;
  }

  if (skill.kind === "heal") {
    return selectLowestHpPercentAlly(state, actor, true) ?? selectLowestHpPercentAlly(state, actor, false);
  }

  if (skill.kind === "shield") {
    return selectVulnerableAlly(state, actor) ?? selectLowestHpPercentAlly(state, actor, false);
  }

  return selectOffensiveTarget(state, actor, skill);
}

function isSkillUsable(actor: BattleUnit, skill: SkillDefinition): boolean {
  const cooldown = actor.cooldowns[skill.id] ?? 0;
  const energyCost = skill.energyCost ?? 0;

  return cooldown <= 0 && actor.energy >= energyCost;
}

export function selectLowestHpEnemy(state: BattleState, actor: BattleUnit): BattleUnit | null {
  return Object.values(state.units)
    .filter((unit) => !unit.isDefeated && unit.teamId !== actor.teamId)
    .sort((left, right) => compareUnitsByCurrentHp(state, left, right, actor.unitId))
    .at(0) ?? null;
}

export function selectLowestHpPercentAlly(
  state: BattleState,
  actor: BattleUnit,
  injuredOnly: boolean,
): BattleUnit | null {
  return Object.values(state.units)
    .filter((unit) => !unit.isDefeated && unit.teamId === actor.teamId)
    .filter((unit) => (injuredOnly ? unit.currentHp < unit.maxHp : true))
    .sort((left, right) => compareUnitsByHpRatio(state, left, right, actor.unitId))
    .at(0) ?? null;
}

export function selectVulnerableAlly(state: BattleState, actor: BattleUnit): BattleUnit | null {
  return Object.values(state.units)
    .filter((unit) => !unit.isDefeated && unit.teamId === actor.teamId)
    .filter((unit) => isUnitAtRisk(state, unit))
    .sort((left, right) => compareUnitsByRisk(state, left, right, actor.unitId))
    .at(0) ?? null;
}

export function selectOffensiveTarget(
  state: BattleState,
  actor: BattleUnit,
  skill?: SkillDefinition,
): BattleUnit | null {
  if (skill?.targetType === "self") {
    return actor;
  }

  if (skill?.targetType === "ally") {
    return selectLowestHpPercentAlly(state, actor, false);
  }

  return selectPreferredEnemyTarget(state, actor);
}

function getUsableSkills(state: BattleState, actor: BattleUnit): SkillDefinition[] {
  return actor.skillIds
    .map((skillId) => state.skills[skillId])
    .filter((skill): skill is SkillDefinition => Boolean(skill))
    .filter((skill) => isSkillUsable(actor, skill));
}

function decideAggressiveAction(
  state: BattleState,
  actor: BattleUnit,
  usableSkills: SkillDefinition[],
): BattleAction | null {
  return createSkillAction(state, actor, rankSkillsByTrait(state, actor, usableSkills.filter(isOffensiveSkill)));
}

function decideSupportiveAction(
  state: BattleState,
  actor: BattleUnit,
  usableSkills: SkillDefinition[],
): BattleAction | null {
  const healSkills = usableSkills.filter((skill) => skill.kind === "heal");
  const healTarget = selectPriorityHealTarget(state, actor, {
    preferSelfPreservation: true,
  });

  if (healTarget) {
    const healAction = createSkillAction(state, actor, rankSkillsByTrait(state, actor, healSkills), healTarget);

    if (healAction) {
      return healAction;
    }
  }

  const shieldAction = createShieldAction(state, actor, usableSkills);

  if (shieldAction) {
    return shieldAction;
  }

  return createSkillAction(state, actor, rankSkillsByTrait(state, actor, usableSkills.filter(isOffensiveSkill)));
}

function decideDefensiveAction(
  state: BattleState,
  actor: BattleUnit,
  usableSkills: SkillDefinition[],
): BattleAction | null {
  const shieldAction = createShieldAction(state, actor, usableSkills);

  if (shieldAction) {
    return shieldAction;
  }

  return createSkillAction(state, actor, rankSkillsByTrait(state, actor, usableSkills.filter(isOffensiveSkill)));
}

function decideControlAction(
  state: BattleState,
  actor: BattleUnit,
  usableSkills: SkillDefinition[],
): BattleAction | null {
  const controlSkills = usableSkills.filter(isControlSkill);
  const controlAction = createSkillAction(state, actor, rankSkillsByTrait(state, actor, controlSkills));

  if (controlAction) {
    return controlAction;
  }

  return createSkillAction(state, actor, rankSkillsByTrait(state, actor, usableSkills.filter(isOffensiveSkill)));
}

function createSkillAction(
  state: BattleState,
  actor: BattleUnit,
  skills: SkillDefinition[],
  forcedTarget?: BattleUnit | null,
): BattleAction | null {
  for (const skill of skills) {
    if (shouldSkipSkillForTrait(state, actor, skill)) {
      continue;
    }

    const target = forcedTarget ?? selectSkillTarget(state, actor, skill);

    if (target) {
      const action: BattleAction = {
        actionType: "skill",
        actorId: actor.unitId,
        targetId: target.unitId,
        skillId: skill.id,
        source: "auto",
      };

      const decisionNote = createDecisionNote(actor, skill.name, target.name);

      if (decisionNote) {
        action.decisionNote = decisionNote;
      }

      const validation = validateAction(state, action);

      if (validation.isValid) {
        return action;
      }
    }
  }

  return null;
}

function createBasicAttackAction(actor: BattleUnit, state: BattleState): BattleAction {
  const fallbackTarget = selectPreferredEnemyTarget(state, actor) ?? actor;

  const action: BattleAction = {
    actionType: "basic_attack",
    actorId: actor.unitId,
    targetId: fallbackTarget.unitId,
    source: "auto",
  };

  const decisionNote = createDecisionNote(actor, "Basic Attack", fallbackTarget.name);

  if (decisionNote) {
    action.decisionNote = decisionNote;
  }

  return action;
}

function isOffensiveSkill(skill: SkillDefinition): boolean {
  return skill.targetType === "enemy" && (skill.kind === "damage" || skill.kind === "apply_status");
}

function isControlSkill(skill: SkillDefinition): boolean {
  return (
    skill.targetType === "enemy" &&
    (skill.statusEffect?.type === StatusEffectType.Stun ||
      skill.statusEffect?.type === StatusEffectType.Poison ||
      skill.kind === "apply_status")
  );
}

function isUnitVulnerable(unit: BattleUnit): boolean {
  return unit.currentHp / unit.maxHp <= VULNERABLE_HP_RATIO;
}

function decideProtectorAction(
  state: BattleState,
  actor: BattleUnit,
  usableSkills: SkillDefinition[],
): BattleAction | null {
  const healSkills = usableSkills.filter((skill) => skill.kind === "heal");
  const healTarget = selectPriorityHealTarget(state, actor);

  if (healTarget && healSkills.length > 0) {
    return createSkillAction(state, actor, rankSkillsByTrait(state, actor, healSkills), healTarget);
  }

  return createShieldAction(state, actor, usableSkills);
}

function decideBossAction(
  state: BattleState,
  actor: BattleUnit,
  usableSkills: SkillDefinition[],
): BattleAction | null {
  const offensiveSkills = usableSkills.filter(isOffensiveSkill);
  const rankedSkills = [...offensiveSkills].sort(
    (left, right) => scoreBossSkill(state, actor, right) - scoreBossSkill(state, actor, left),
  );

  return createSkillAction(state, actor, rankedSkills);
}

function rankSkillsByTrait(state: BattleState, actor: BattleUnit, skills: SkillDefinition[]): SkillDefinition[] {
  return [...skills].sort((left, right) => scoreSkillForTrait(state, actor, right) - scoreSkillForTrait(state, actor, left));
}

function scoreSkillForTrait(state: BattleState, actor: BattleUnit, skill: SkillDefinition): number {
  let score = 0;

  if (isOffensiveSkill(skill)) {
    score += 10;
  }

  if (actor.trait === "aggressive" && isOffensiveSkill(skill)) {
    score += 5 + (skill.power ?? 0);
  }

  if (actor.trait === "opportunist" && isOffensiveSkill(skill)) {
    const target = selectSkillTarget(state, actor, skill);

    if (target && hasNegativeStatus(target)) {
      score += 6;
    }
  }

  return score;
}

function scoreBossSkill(state: BattleState, actor: BattleUnit, skill: SkillDefinition): number {
  let score = scoreSkillForTrait(state, actor, skill);
  const target = selectSkillTarget(state, actor, skill);

  if (target && isBacklineRole(target.role)) {
    score += 8;
  }

  if (target && target.currentHp / target.maxHp <= HEAL_TRIGGER_HP_RATIO) {
    score += 4;
  }

  if (skill.id === "tyrant-rush") {
    score += 8;

    if (target && isBacklineRole(target.role)) {
      score += 6;
    }

    if (target && getActiveShieldPotency(target) > 0) {
      score += 4;
    }

    if (state.turn >= 8) {
      score += 5;
    }
  }

  if (skill.id === "crushing-slam" && state.turn <= 6) {
    score += 3;
  }

  return score;
}

function shouldSkipSkillForTrait(state: BattleState, actor: BattleUnit, skill: SkillDefinition): boolean {
  if (actor.trait !== "cautious" || !isOffensiveSkill(skill)) {
    return false;
  }

  const target = selectSkillTarget(state, actor, skill);

  if (!target) {
    return true;
  }

  const basicAttackDamage = estimateBasicAttackDamage(actor, target);
  const skillDamage = estimateSkillDamage(actor, target, skill);

  return basicAttackDamage >= target.currentHp || skillDamage <= basicAttackDamage;
}

function estimateBasicAttackDamage(actor: BattleUnit, target: BattleUnit): number {
  return Math.max(1, actor.attack - target.defense);
}

function estimateSkillDamage(actor: BattleUnit, target: BattleUnit, skill: SkillDefinition): number {
  return Math.max(1, actor.attack + (skill.power ?? 0) - target.defense);
}

function selectPreferredEnemyTarget(state: BattleState, actor: BattleUnit): BattleUnit | null {
  if (actor.role === "boss") {
    return selectBossPriorityTarget(state, actor);
  }

  if (actor.trait === "opportunist") {
    return selectDebuffedEnemy(state, actor) ?? selectLowestHpEnemy(state, actor);
  }

  return selectLowestHpEnemy(state, actor);
}

function selectBossPriorityTarget(state: BattleState, actor: BattleUnit): BattleUnit | null {
  const enemies = Object.values(state.units)
    .filter((unit) => !unit.isDefeated && unit.teamId !== actor.teamId)
    .sort((left, right) => {
      const rolePriority = getBossTargetPriority(left) - getBossTargetPriority(right);

      if (rolePriority !== 0) {
        return rolePriority;
      }

      return compareUnitsByRisk(state, left, right, actor.unitId);
    });

  return enemies.at(0) ?? null;
}

function getBossTargetPriority(unit: BattleUnit): number {
  switch (unit.role) {
    case "support":
      return 0;
    case "controller":
      return 1;
    case "assassin":
      return 2;
    case "tank":
      return 3;
    default:
      return 4;
  }
}

function selectDebuffedEnemy(state: BattleState, actor: BattleUnit): BattleUnit | null {
  return Object.values(state.units)
    .filter((unit) => !unit.isDefeated && unit.teamId !== actor.teamId && hasNegativeStatus(unit))
    .sort((left, right) => compareUnitsByCurrentHp(state, left, right, actor.unitId))
    .at(0) ?? null;
}

function hasNegativeStatus(unit: BattleUnit): boolean {
  return unit.statuses.some(
    (status) =>
      status.remainingTurns > 0 &&
      (status.type === StatusEffectType.Poison || status.type === StatusEffectType.Stun),
  );
}

function createDecisionNote(actor: BattleUnit, actionName: string, targetName: string): string | undefined {
  if (!actor.trait) {
    return undefined;
  }

  return `${actor.name} chooses ${actionName} on ${targetName} with ${actor.trait} trait.`;
}

function describeAction(state: BattleState, action: BattleAction): string {
  if (action.actionType === "skill" && action.skillId) {
    return state.skills[action.skillId]?.name ?? action.skillId;
  }

  return "Basic Attack";
}

function createShieldAction(
  state: BattleState,
  actor: BattleUnit,
  usableSkills: SkillDefinition[],
): BattleAction | null {
  const shieldSkills = usableSkills.filter((skill) => skill.kind === "shield");
  const shieldTarget = selectShieldTarget(state, actor);

  if (!shieldTarget || shieldSkills.length === 0) {
    return null;
  }

  return createSkillAction(state, actor, shieldSkills, shieldTarget);
}

function selectPriorityHealTarget(
  state: BattleState,
  actor: BattleUnit,
  options?: {
    preferSelfPreservation?: boolean;
  },
): BattleUnit | null {
  if (options?.preferSelfPreservation && shouldSelfPreserveWithHeal(state, actor)) {
    return actor;
  }

  const allies = Object.values(state.units)
    .filter((unit) => !unit.isDefeated && unit.teamId === actor.teamId && unit.currentHp < unit.maxHp)
    .sort((left, right) => compareUnitsByRisk(state, left, right, actor.unitId));

  return allies.find((unit) => shouldHealTarget(state, unit)) ?? null;
}

function shouldHealTarget(state: BattleState, unit: BattleUnit): boolean {
  const missingHp = unit.maxHp - unit.currentHp;
  const hpRatio = unit.currentHp / unit.maxHp;

  return (
    missingHp >= MIN_MEANINGFUL_HEAL ||
    hpRatio <= HEAL_TRIGGER_HP_RATIO ||
    (isBacklineRole(unit.role) && hpRatio <= BACKLINE_HEAL_TRIGGER_HP_RATIO) ||
    isUnitAtRisk(state, unit)
  );
}

function shouldSelfPreserveWithHeal(state: BattleState, actor: BattleUnit): boolean {
  if (actor.currentHp >= actor.maxHp) {
    return false;
  }

  const hpRatio = actor.currentHp / actor.maxHp;
  const missingHp = actor.maxHp - actor.currentHp;
  const threat = estimateIncomingThreat(state, actor);

  return (
    hpRatio <= SUPPORT_SELF_PRESERVE_HP_RATIO ||
    missingHp >= MIN_MEANINGFUL_HEAL - 1 ||
    isUnitAtRisk(state, actor) ||
    threat >= Math.max(4, Math.floor(actor.currentHp / 2))
  );
}

function selectShieldTarget(state: BattleState, actor: BattleUnit): BattleUnit | null {
  return Object.values(state.units)
    .filter((unit) => !unit.isDefeated && unit.teamId === actor.teamId)
    .filter((unit) => shouldShieldUnit(state, unit))
    .sort((left, right) => compareUnitsByRisk(state, left, right, actor.unitId))
    .at(0) ?? null;
}

function shouldShieldUnit(state: BattleState, unit: BattleUnit): boolean {
  const threat = estimateIncomingThreat(state, unit);
  const shieldPotency = getActiveShieldPotency(unit);

  if (threat <= 0) {
    return false;
  }

  if (shieldPotency >= threat + SHIELD_THREAT_BUFFER) {
    return false;
  }

  return (
    unit.currentHp / unit.maxHp <= HEAL_TRIGGER_HP_RATIO ||
    isUnitAtRisk(state, unit) ||
    (isBacklineRole(unit.role) && threat >= 4) ||
    (unit.currentHp < unit.maxHp && shieldPotency < threat)
  );
}

function isUnitAtRisk(state: BattleState, unit: BattleUnit): boolean {
  const threat = estimateIncomingThreat(state, unit);
  const effectiveHp = unit.currentHp + getActiveShieldPotency(unit);

  return (
    unit.currentHp / unit.maxHp <= CRITICAL_HP_RATIO ||
    (threat > 0 && effectiveHp <= threat * 2) ||
    (isBacklineRole(unit.role) && threat >= unit.currentHp)
  );
}

function estimateIncomingThreat(state: BattleState, unit: BattleUnit): number {
  return Object.values(state.units)
    .filter((enemy) => !enemy.isDefeated && enemy.teamId !== unit.teamId)
    .reduce((highest, enemy) => Math.max(highest, estimateBasicAttackDamage(enemy, unit)), 0);
}

function getActiveShieldPotency(unit: BattleUnit): number {
  return unit.statuses
    .filter((status) => status.type === StatusEffectType.Shield && status.remainingTurns > 0)
    .reduce((total, status) => total + (status.potency ?? 0), 0);
}

function isBacklineRole(role?: string): boolean {
  return role === "support" || role === "controller";
}

function compareUnitsByCurrentHp(
  state: BattleState,
  left: BattleUnit,
  right: BattleUnit,
  context: string,
): number {
  if (left.currentHp !== right.currentHp) {
    return left.currentHp - right.currentHp;
  }

  const tieBreak = compareUnitTieBreak(state, left, right, `hp:${context}`);

  if (tieBreak !== 0) {
    return tieBreak;
  }

  return left.unitId.localeCompare(right.unitId);
}

function compareUnitsByHpRatio(
  state: BattleState,
  left: BattleUnit,
  right: BattleUnit,
  context: string,
): number {
  const leftRatio = left.currentHp / left.maxHp;
  const rightRatio = right.currentHp / right.maxHp;

  if (leftRatio !== rightRatio) {
    return leftRatio - rightRatio;
  }

  if (left.currentHp !== right.currentHp) {
    return left.currentHp - right.currentHp;
  }

  const tieBreak = compareUnitTieBreak(state, left, right, `ratio:${context}`);

  if (tieBreak !== 0) {
    return tieBreak;
  }

  return left.unitId.localeCompare(right.unitId);
}

function compareUnitsByRisk(state: BattleState, left: BattleUnit, right: BattleUnit, context: string): number {
  const leftScore = scoreUnitRisk(state, left);
  const rightScore = scoreUnitRisk(state, right);

  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }

  return compareUnitsByHpRatio(state, left, right, context);
}

function scoreUnitRisk(state: BattleState, unit: BattleUnit): number {
  const hpRatioScore = Math.round((1 - unit.currentHp / unit.maxHp) * 100);
  const threatScore = estimateIncomingThreat(state, unit) * 5;
  const backlineBonus = isBacklineRole(unit.role) ? 8 : 0;
  const shieldPenalty = getActiveShieldPotency(unit);

  return hpRatioScore + threatScore + backlineBonus - shieldPenalty;
}

function compareUnitTieBreak(state: BattleState, left: BattleUnit, right: BattleUnit, context: string): number {
  return (
    deterministicTieBreak(state.random.initialSeed, context, left.unitId, right.unitId) -
    deterministicTieBreak(state.random.initialSeed, context, right.unitId, left.unitId)
  );
}
