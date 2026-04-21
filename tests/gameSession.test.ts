import { describe, expect, it } from "vitest";

import { simulateBattle } from "../src/battle/BattleSimulation.js";
import type { CharacterDefinition } from "../src/domain/CharacterDefinition.js";
import type { BattleScenarioTeam } from "../src/game/BattleScenario.js";
import { GameSession, type CampaignEncounterTemplate, type PartyOption } from "../src/game/GameSession.js";

const weakHero: CharacterDefinition = {
  id: "weak-hero",
  name: "Weak Hero",
  role: "fighter",
  aiProfile: "aggressive",
  baseStats: {
    hp: 12,
    attack: 2,
    defense: 1,
    speed: 6,
  },
  skillIds: [],
};

const strongHero: CharacterDefinition = {
  id: "strong-hero",
  name: "Strong Hero",
  role: "fighter",
  aiProfile: "aggressive",
  baseStats: {
    hp: 42,
    attack: 14,
    defense: 5,
    speed: 12,
  },
  skillIds: [],
};

const weakEnemy: CharacterDefinition = {
  id: "weak-enemy",
  name: "Weak Enemy",
  role: "fighter",
  aiProfile: "aggressive",
  baseStats: {
    hp: 10,
    attack: 2,
    defense: 1,
    speed: 5,
  },
  skillIds: [],
};

const strongEnemy: CharacterDefinition = {
  id: "strong-enemy",
  name: "Strong Enemy",
  role: "fighter",
  aiProfile: "aggressive",
  baseStats: {
    hp: 50,
    attack: 16,
    defense: 6,
    speed: 10,
  },
  skillIds: [],
};

function createEnemyTeam(teamId: string, unitId: string, character: CharacterDefinition): BattleScenarioTeam {
  return {
    teamId,
    units: [{ unitId, character }],
  };
}

function createCampaign(enemy: CharacterDefinition, count: number): CampaignEncounterTemplate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `encounter-${index + 1}`,
    name: `Encounter ${index + 1}`,
    enemyTeam: createEnemyTeam("enemy", `enemy-${index + 1}`, enemy),
    skills: [],
  }));
}

function createSession(partyOptions: PartyOption[], campaign: CampaignEncounterTemplate[]) {
  return new GameSession({
    partyOptions,
    campaign,
    baseSeed: 99,
    hpRewardPerVictory: 4,
  });
}

describe("GameSession", () => {
  it("a session advances correctly after a win", () => {
    const session = createSession(
      [{ id: "strong", label: "Strong", members: [strongHero] }],
      createCampaign(weakEnemy, 2),
    );

    session.selectParty("strong");
    const summary = session.playNextEncounter();
    const snapshot = session.getSnapshot();

    expect(summary.playerWon).toBe(true);
    expect(summary.rewardApplied).toContain("+4 HP");
    expect(snapshot.status).toBe("in_progress");
    expect(snapshot.completedEncounters).toBe(1);
    expect(snapshot.currentEncounterIndex).toBe(1);
    expect(snapshot.party[0]?.baseStats.hp).toBe(strongHero.baseStats.hp + 4);
  });

  it("losing a battle ends the run immediately", () => {
    const session = createSession(
      [{ id: "weak", label: "Weak", members: [weakHero] }],
      createCampaign(strongEnemy, 2),
    );

    session.selectParty("weak");
    const summary = session.playNextEncounter();
    const snapshot = session.getSnapshot();

    expect(summary.playerWon).toBe(false);
    expect(session.getStatus()).toBe("lost");
    expect(snapshot.completedEncounters).toBe(1);
    expect(snapshot.currentEncounterIndex).toBe(0);
    expect(() => session.playNextEncounter()).toThrow(/lost/);
  });

  it("winning all encounters completes the campaign", () => {
    const session = createSession(
      [{ id: "strong", label: "Strong", members: [strongHero] }],
      createCampaign(weakEnemy, 3),
    );

    session.selectParty("strong");
    session.playNextEncounter();
    session.playNextEncounter();
    session.applyPreBossUpgrade("pre-boss-hp");
    const finalSummary = session.playNextEncounter();

    expect(finalSummary.playerWon).toBe(true);
    expect(session.getStatus()).toBe("completed");
    expect(session.getSnapshot().completedEncounters).toBe(3);
    expect(session.getCurrentEncounterTemplate()).toBeNull();
  });

  it("creates scenarios that still run through simulateBattle", () => {
    const session = createSession(
      [{ id: "strong", label: "Strong", members: [strongHero] }],
      createCampaign(weakEnemy, 1),
    );

    session.selectParty("strong");
    const scenario = session.createCurrentScenario();
    const simulation = simulateBattle(scenario, { seed: 123 });

    expect(scenario.teams[0].units).toHaveLength(1);
    expect(simulation.finalState.lifecycle).toBe("finished");
    expect(simulation.metrics.turnCount).toBeGreaterThan(0);
    expect(["party", "enemy"]).toContain(simulation.finalState.winnerTeamId);
  });

  it("requires a pre-boss upgrade before the final encounter", () => {
    const session = createSession(
      [{ id: "strong", label: "Strong", members: [strongHero] }],
      createCampaign(weakEnemy, 3),
    );

    session.selectParty("strong");
    session.playNextEncounter();
    session.playNextEncounter();

    expect(session.hasPendingPreBossUpgrade()).toBe(true);
    expect(() => session.playNextEncounter()).toThrow(/Pre-boss upgrade/);
  });

  it("applies each pre-boss upgrade correctly", () => {
    const hpSession = createSession(
      [{ id: "strong", label: "Strong", members: [strongHero] }],
      createCampaign(weakEnemy, 3),
    );
    hpSession.selectParty("strong");
    hpSession.playNextEncounter();
    hpSession.playNextEncounter();
    hpSession.applyPreBossUpgrade("pre-boss-hp");
    expect(hpSession.getParty()[0]?.baseStats.hp).toBe(strongHero.baseStats.hp + 8 + 4 + 4);

    const attackSession = createSession(
      [{ id: "strong", label: "Strong", members: [strongHero] }],
      createCampaign(weakEnemy, 3),
    );
    attackSession.selectParty("strong");
    attackSession.playNextEncounter();
    attackSession.playNextEncounter();
    attackSession.applyPreBossUpgrade("pre-boss-attack");
    expect(attackSession.getParty()[0]?.baseStats.attack).toBe(strongHero.baseStats.attack + 2);

    const defenseSession = createSession(
      [{ id: "strong", label: "Strong", members: [strongHero] }],
      createCampaign(weakEnemy, 3),
    );
    defenseSession.selectParty("strong");
    defenseSession.playNextEncounter();
    defenseSession.playNextEncounter();
    defenseSession.applyPreBossUpgrade("pre-boss-defense");
    expect(defenseSession.getParty()[0]?.baseStats.defense).toBe(strongHero.baseStats.defense + 1);
  });

  it("the pre-boss upgrade only affects the current run", () => {
    const firstSession = createSession(
      [{ id: "strong", label: "Strong", members: [strongHero] }],
      createCampaign(weakEnemy, 3),
    );
    firstSession.selectParty("strong");
    firstSession.playNextEncounter();
    firstSession.playNextEncounter();
    firstSession.applyPreBossUpgrade("pre-boss-attack");

    const secondSession = createSession(
      [{ id: "strong", label: "Strong", members: [strongHero] }],
      createCampaign(weakEnemy, 3),
    );
    secondSession.selectParty("strong");

    expect(firstSession.getSelectedPreBossUpgrade()?.optionId).toBe("pre-boss-attack");
    expect(firstSession.getParty()[0]?.baseStats.attack).toBe(strongHero.baseStats.attack + 2);
    expect(secondSession.getSelectedPreBossUpgrade()).toBeUndefined();
    expect(secondSession.getParty()[0]?.baseStats.attack).toBe(strongHero.baseStats.attack);
  });

  it("the boss fight still produces a valid simulation after choosing a pre-boss upgrade", () => {
    const session = createSession(
      [{ id: "strong", label: "Strong", members: [strongHero] }],
      createCampaign(weakEnemy, 3),
    );

    session.selectParty("strong");
    session.playNextEncounter();
    session.playNextEncounter();
    session.applyPreBossUpgrade("pre-boss-defense");

    const scenario = session.createCurrentScenario();
    const simulation = simulateBattle(scenario, { seed: 456 });

    expect(simulation.finalState.lifecycle).toBe("finished");
    expect(simulation.metrics.turnCount).toBeGreaterThan(0);
    expect(["party", "enemy"]).toContain(simulation.finalState.winnerTeamId);
  });
});
