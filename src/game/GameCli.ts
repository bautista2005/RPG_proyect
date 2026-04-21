import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { GameBattleSummary, GameSession } from "./GameSession.js";

function formatPartyStats(session: GameSession): string {
  return session
    .getParty()
    .map(
      (character) =>
        `${character.name} HP=${character.baseStats.hp} ATK=${character.baseStats.attack} DEF=${character.baseStats.defense} SPD=${character.baseStats.speed}`,
    )
    .join("\n");
}

function formatPartyBattleState(summary: GameBattleSummary): string {
  return summary.partyState
    .map((member) =>
      `${member.name}: ${member.isDefeated ? "defeated" : `${member.currentHp}/${member.maxHp} HP`} energy=${member.energy}`,
    )
    .join("\n");
}

function formatTopMetrics(summary: GameBattleSummary): string {
  return Object.values(summary.result.metrics.unitMetrics)
    .filter((metric) => metric.teamId === summary.scenario.teams[0].teamId)
    .sort((left, right) => right.damageDealt - left.damageDealt || left.name.localeCompare(right.name))
    .map(
      (metric) =>
        `${metric.name}: dmg=${metric.damageDealt} taken=${metric.damageTaken} heal=${metric.healingDone} actions=${metric.actionsTaken}`,
    )
    .join("\n");
}

async function askForMenuChoice(
  question: string,
  maxChoice: number,
  reader: ReturnType<typeof createInterface>,
): Promise<number> {
  while (true) {
    const answer = (await reader.question(question)).trim();
    const choice = Number.parseInt(answer, 10);

    if (Number.isInteger(choice) && choice >= 1 && choice <= maxChoice) {
      return choice;
    }

    console.log(`Choose a number between 1 and ${maxChoice}.`);
  }
}

async function askYesNo(question: string, reader: ReturnType<typeof createInterface>): Promise<boolean> {
  while (true) {
    const answer = (await reader.question(question)).trim().toLowerCase();

    if (answer === "y" || answer === "yes" || answer === "s" || answer === "si") {
      return true;
    }

    if (answer === "n" || answer === "no") {
      return false;
    }

    console.log("Answer with y/n.");
  }
}

export async function runCliGame(createSession: () => GameSession): Promise<void> {
  const reader = createInterface({ input, output });

  try {
    let keepPlaying = true;

    while (keepPlaying) {
      const session = createSession();

      console.log("=== Tactical RPG v10 ===");
      console.log("Choose your party:");
      session.partyOptions.forEach((option, index) => {
        console.log(`${index + 1}. ${option.label}`);
      });

      const partyChoice = await askForMenuChoice("> ", session.partyOptions.length, reader);
      const partyOption = session.partyOptions[partyChoice - 1];
      session.selectParty(partyOption.id);

      console.log("");
      console.log(`Selected party: ${partyOption.label}`);
      console.log(formatPartyStats(session));
      console.log("");
      console.log("Campaign:");
      session.campaign.forEach((encounter, index) => {
        console.log(`${index + 1}. ${encounter.name}`);
      });
      console.log("");

      while (session.getStatus() === "in_progress") {
        const snapshot = session.getSnapshot();
        const encounter = session.getCurrentEncounterTemplate();

        if (!encounter) {
          break;
        }

        if (session.hasPendingPreBossUpgrade()) {
          console.log("Final boss preparation:");
          console.log("Choose one upgrade for this run:");
          session.preBossUpgradeOptions.forEach((option, index) => {
            console.log(`${index + 1}. ${option.description}`);
          });

          const partyStatsBeforeUpgrade = formatPartyStats(session);
          const upgradeChoice = await askForMenuChoice("> ", session.preBossUpgradeOptions.length, reader);
          const selectedUpgrade = session.applyPreBossUpgrade(session.preBossUpgradeOptions[upgradeChoice - 1].id);

          console.log(`Selected upgrade: ${selectedUpgrade.label} (${selectedUpgrade.description})`);
          console.log("Party stats before upgrade:");
          console.log(partyStatsBeforeUpgrade);
          console.log("Party stats after upgrade:");
          console.log(formatPartyStats(session));
          console.log("");
        }

        console.log(`Battle ${snapshot.completedEncounters + 1}/${snapshot.totalEncounters}: ${encounter.name}`);
        if (encounter.description) {
          console.log(encounter.description);
        }
        await reader.question("Press Enter to simulate the battle...");

        const summary = session.playNextEncounter();

        console.log(`Winner: ${summary.result.finalState.winnerTeamId ?? "none"}`);
        console.log(`Turns: ${summary.result.metrics.turnCount}`);
        console.log(`Actions: ${summary.result.executedActions}`);
        console.log("Party state:");
        console.log(formatPartyBattleState(summary));
        console.log("Party metrics:");
        console.log(formatTopMetrics(summary));

        if (summary.rewardApplied) {
          console.log(summary.rewardApplied);
          console.log("Updated party stats:");
          console.log(formatPartyStats(session));
        }

        console.log(summary.playerWon ? "Encounter cleared." : "Run failed.");
        console.log("");
      }

      console.log(session.getStatus() === "completed" ? "Campaign completed." : "The run is over.");
      keepPlaying = await askYesNo("Play again? (y/n) ", reader);
      console.log("");
    }
  } finally {
    reader.close();
  }
}
