import type { BattleScenario } from "../../game/BattleScenario.js";
import { assassin, controller, support, tank } from "../characters/roster.js";
import { ogreBoss } from "../characters/bosses.js";
import { bossSkills } from "../skills/bossSkills.js";
import { rosterSkills } from "../skills/rosterSkills.js";

export const balancedDuelScenario: BattleScenario = {
  id: "balanced-duel",
  name: "Balanced Duel",
  description: "A mixed-role skirmish meant to expose baseline damage, control and sustain tradeoffs.",
  skills: rosterSkills,
  teams: [
    {
      teamId: "heroes",
      units: [
        { unitId: "heroes-tank", character: tank },
        { unitId: "heroes-controller", character: controller },
      ],
    },
    {
      teamId: "raiders",
      units: [
        { unitId: "raiders-assassin", character: assassin },
        { unitId: "raiders-support", character: support },
      ],
    },
  ],
};

export const healerVsBurstScenario: BattleScenario = {
  id: "healer-vs-burst",
  name: "Healer Vs Burst",
  description: "A sustain line faces a faster damage-focused enemy team.",
  skills: rosterSkills,
  teams: [
    {
      teamId: "allies",
      units: [
        { unitId: "allies-tank", character: tank },
        { unitId: "allies-support", character: support },
      ],
    },
    {
      teamId: "hunters",
      units: [
        { unitId: "hunters-assassin", character: assassin },
        { unitId: "hunters-controller", character: controller },
      ],
    },
  ],
};

export const controlVsSustainScenario: BattleScenario = {
  id: "control-vs-sustain",
  name: "Control Vs Sustain",
  description: "Control pressure and poison race against healing and shielding.",
  skills: rosterSkills,
  teams: [
    {
      teamId: "control",
      units: [
        { unitId: "control-controller", character: controller },
        { unitId: "control-assassin", character: assassin },
      ],
    },
    {
      teamId: "sustain",
      units: [
        { unitId: "sustain-tank", character: tank },
        { unitId: "sustain-support", character: support },
      ],
    },
  ],
};

export const burstVsSustainScenario: BattleScenario = {
  id: "burst-vs-sustain",
  name: "Burst Vs Sustain",
  description: "Sustain tools absorb repeated burst so shield and healing impact are easy to read.",
  skills: rosterSkills,
  teams: [
    {
      teamId: "bulwark",
      units: [
        { unitId: "bulwark-tank", character: tank },
        { unitId: "bulwark-support", character: support },
      ],
    },
    {
      teamId: "venom",
      units: [
        { unitId: "venom-assassin-a", character: assassin },
        { unitId: "venom-assassin-b", character: assassin },
      ],
    },
  ],
};

export const burstPunishScenario: BattleScenario = {
  id: "burst-punish-seraph",
  name: "Burst Punish",
  description: "A fragile backline must survive an immediate damage spike and show whether support stabilization lands in time.",
  skills: rosterSkills,
  teams: [
    {
      teamId: "guardians",
      units: [
        { unitId: "guardians-support", character: support },
        { unitId: "guardians-controller", character: controller },
      ],
    },
    {
      teamId: "raiders",
      units: [
        { unitId: "raiders-assassin-a", character: assassin },
        { unitId: "raiders-assassin-b", character: assassin },
      ],
    },
  ],
};

export const enduranceGrindScenario: BattleScenario = {
  id: "endurance-grind",
  name: "Endurance Grind",
  description: "A long sustain-heavy setup makes healing throughput, mitigation and action waste easy to compare.",
  skills: rosterSkills,
  config: {
    maxTurns: 300,
  },
  teams: [
    {
      teamId: "anchors",
      units: [
        { unitId: "anchors-tank", character: tank, overrides: { hp: 42, defense: 6 } },
        { unitId: "anchors-support", character: support, overrides: { hp: 28 } },
      ],
    },
    {
      teamId: "grinders",
      units: [
        { unitId: "grinders-tank", character: tank, overrides: { hp: 40 } },
        { unitId: "grinders-controller", character: controller, overrides: { hp: 30 } },
      ],
    },
  ],
};

export const backlineExposureScenario: BattleScenario = {
  id: "backline-exposure",
  name: "Backline Exposure",
  description: "A frontliner must choose between protecting a pressured backline or contributing damage.",
  skills: rosterSkills,
  teams: [
    {
      teamId: "party",
      units: [
        { unitId: "party-tank", character: tank },
        { unitId: "party-support", character: support, overrides: { hp: 20 } },
      ],
    },
    {
      teamId: "skirmishers",
      units: [
        { unitId: "skirmishers-assassin", character: assassin },
        { unitId: "skirmishers-controller", character: controller },
      ],
    },
  ],
};

export const bossPressureScenario: BattleScenario = {
  id: "boss-pressure-check",
  name: "Boss Pressure Check",
  description: "A lean party faces the boss directly so backline punishment and support stabilization are easy to read.",
  skills: [...rosterSkills, ...bossSkills],
  config: {
    maxTurns: 180,
  },
  teams: [
    {
      teamId: "party",
      units: [
        { unitId: "party-tank", character: tank },
        { unitId: "party-support", character: support },
        { unitId: "party-controller", character: controller },
      ],
    },
    {
      teamId: "boss",
      units: [{ unitId: "boss-ogre", character: ogreBoss }],
    },
  ],
};

export const bossFightScenario: BattleScenario = {
  id: "boss-fight-iron-ogre",
  name: "Boss Fight: Iron Ogre",
  description: "The full hero roster tries to stabilize under a boss that hunts backline targets and ramps pressure if the fight drags on.",
  skills: [...rosterSkills, ...bossSkills],
  config: {
    maxTurns: 220,
  },
  teams: [
    {
      teamId: "party",
      units: [
        { unitId: "party-tank", character: tank },
        { unitId: "party-assassin", character: assassin },
        { unitId: "party-support", character: support },
        { unitId: "party-controller", character: controller },
      ],
    },
    {
      teamId: "boss",
      units: [{ unitId: "boss-ogre", character: ogreBoss }],
    },
  ],
};

export const pveScenarios: BattleScenario[] = [
  balancedDuelScenario,
  healerVsBurstScenario,
  controlVsSustainScenario,
  burstVsSustainScenario,
  burstPunishScenario,
  enduranceGrindScenario,
  backlineExposureScenario,
  bossPressureScenario,
  bossFightScenario,
];

export const pveScenarioMap = Object.fromEntries(pveScenarios.map((scenario) => [scenario.id, scenario]));
