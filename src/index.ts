import { fileURLToPath } from "node:url";

import type { BattleSimulationResult } from "./battle/BattleSimulation.js";
import { simulateBattle } from "./battle/BattleSimulation.js";
import { pveScenarios } from "./data/scenarios/pveScenarios.js";
import type { BattleScenario } from "./game/BattleScenario.js";
import { runCliGame } from "./game/GameCli.js";
import { GameSession } from "./game/GameSession.js";

export const PROJECT_NAME = "idle-tactical-rpg";
export const DEFAULT_SCENARIO_RUNS = 3;
export const DEFAULT_SERIES_SEED = 1337;

export interface ScenarioSeriesSummary {
  scenarioId: string;
  scenarioName: string;
  runs: BattleSimulationResult[];
  winsByTeam: Record<string, number>;
  averageTurns: number;
  turnRange: [number, number];
  seeds: number[];
}

export function runScenario(scenario: BattleScenario, options?: { seed?: number }): BattleSimulationResult {
  return simulateBattle(scenario, options);
}

export function runScenarioSeries(
  scenario: BattleScenario,
  runs = DEFAULT_SCENARIO_RUNS,
  baseSeed = DEFAULT_SERIES_SEED,
): ScenarioSeriesSummary {
  const seeds = Array.from({ length: runs }, (_, index) => baseSeed + index);
  const results = seeds.map((seed) => runScenario(scenario, { seed }));
  const winsByTeam = results.reduce<Record<string, number>>((wins, result) => {
    const teamId = result.finalState.winnerTeamId ?? "none";
    wins[teamId] = (wins[teamId] ?? 0) + 1;
    return wins;
  }, {});
  const averageTurns = results.reduce((sum, result) => sum + result.metrics.turnCount, 0) / results.length;
  const turnCounts = results.map((result) => result.metrics.turnCount);

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    runs: results,
    winsByTeam,
    averageTurns,
    turnRange: [Math.min(...turnCounts), Math.max(...turnCounts)],
    seeds,
  };
}

export function runScenarioSuite(
  runsPerScenario = DEFAULT_SCENARIO_RUNS,
  baseSeed = DEFAULT_SERIES_SEED,
): ScenarioSeriesSummary[] {
  return pveScenarios.map((scenario, index) => runScenarioSeries(scenario, runsPerScenario, baseSeed + index * 100));
}

export function printScenarioResult(result: BattleSimulationResult) {
  console.log(`Winner: ${result.finalState.winnerTeamId ?? "none"}`);
  console.log(`Turns: ${result.metrics.turnCount}`);
  console.log(`Actions: ${result.executedActions}`);

  for (const unit of Object.values(result.metrics.unitMetrics).sort(compareMetricsForDisplay)) {
    const skills =
      Object.entries(unit.skillUsage)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([skillId, uses]) => `${skillId}=${uses}`)
        .join(", ") || "none";

    console.log(
      [
        `${unit.name} [${unit.teamId}]`,
        `dmg=${unit.damageDealt}`,
        `taken=${unit.damageTaken}`,
        `heal=${unit.healingDone}`,
        `shield=${unit.shieldApplied}`,
        `mit=${unit.damageMitigated}`,
        `actions=${unit.actionsTaken}`,
        `basic=${unit.basicAttacks}`,
        `kills=${unit.kills}`,
        `waste=${unit.wastedSupportActions}`,
        `survived=${unit.survived}`,
        `hp=${unit.remainingHp}`,
        `skills={${skills}}`,
      ].join(" "),
    );
  }
}

export function printScenarioSeriesSummary(summary: ScenarioSeriesSummary) {
  console.log(`Scenario: ${summary.scenarioName} (${summary.scenarioId})`);
  console.log(`Average turns: ${summary.averageTurns.toFixed(1)}`);
  console.log(`Turn range: ${summary.turnRange[0]}-${summary.turnRange[1]}`);
  console.log(`Wins: ${formatWinSummary(summary.winsByTeam)}`);
  console.log(`Highlights: ${formatScenarioHighlights(summary.runs)}`);
  console.log(`Seeds: ${summary.seeds.join(", ")}`);

  summary.runs.forEach((result, index) => {
    console.log(`Run ${index + 1} (seed=${summary.seeds[index]})`);
    printScenarioResult(result);
  });
}

function formatWinSummary(winsByTeam: Record<string, number>): string {
  return Object.entries(winsByTeam)
    .map(([teamId, wins]) => `${teamId}=${wins}`)
    .join(", ");
}

function formatScenarioHighlights(runs: BattleSimulationResult[]): string {
  const units = runs.flatMap((run) =>
    Object.values(run.metrics.unitMetrics).map((metric) => ({
      ...metric,
      role: run.finalState.units[metric.unitId]?.role,
    })),
  );
  const bossUnits = units.filter((unit) => unit.role === "boss");
  const supportUnits = units.filter((unit) => unit.role === "support");
  const defensiveWaste = units
    .filter((unit) => unit.role === "tank")
    .reduce((sum, unit) => sum + unit.wastedSupportActions, 0);
  const parts: string[] = [];

  if (bossUnits.length > 0) {
    const bossDamage = average(bossUnits.map((unit) => unit.damageDealt));
    const bossKills = average(bossUnits.map((unit) => unit.kills));
    parts.push(`boss dmg=${bossDamage.toFixed(1)} kills=${bossKills.toFixed(1)}`);
  }

  if (supportUnits.length > 0) {
    const supportHeal = average(supportUnits.map((unit) => unit.healingDone));
    const supportSurvival = supportUnits.filter((unit) => unit.survived).length / supportUnits.length;
    parts.push(`support heal=${supportHeal.toFixed(1)} surv=${(supportSurvival * 100).toFixed(0)}%`);
  }

  parts.push(`tank waste=${defensiveWaste}`);

  return parts.join(" | ");
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareMetricsForDisplay(
  left: BattleSimulationResult["metrics"]["unitMetrics"][string],
  right: BattleSimulationResult["metrics"]["unitMetrics"][string],
): number {
  if (left.teamId !== right.teamId) {
    return left.teamId.localeCompare(right.teamId);
  }

  const leftImpact = left.damageDealt + left.healingDone + left.shieldApplied + left.damageMitigated;
  const rightImpact = right.damageDealt + right.healingDone + right.shieldApplied + right.damageMitigated;

  if (rightImpact !== leftImpact) {
    return rightImpact - leftImpact;
  }

  return left.name.localeCompare(right.name);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

function parseCliOptions(argv: string[]): { runs: number; seed: number; suiteMode: boolean } {
  let runs = DEFAULT_SCENARIO_RUNS;
  let seed = DEFAULT_SERIES_SEED;
  let suiteMode = false;

  for (const arg of argv) {
    if (arg === "--suite") {
      suiteMode = true;
    }

    if (arg.startsWith("--runs=")) {
      runs = Number.parseInt(arg.slice("--runs=".length), 10) || DEFAULT_SCENARIO_RUNS;
    }

    if (arg.startsWith("--seed=")) {
      seed = Number.parseInt(arg.slice("--seed=".length), 10) || DEFAULT_SERIES_SEED;
    }
  }

  return { runs, seed, suiteMode };
}

if (isMainModule) {
  const { runs, seed, suiteMode } = parseCliOptions(process.argv.slice(2));

  if (suiteMode) {
    const suite = runScenarioSuite(runs, seed);

    for (const summary of suite) {
      printScenarioSeriesSummary(summary);
      console.log("");
    }
  } else {
    await runCliGame(() => new GameSession({ baseSeed: seed }));
  }
}
