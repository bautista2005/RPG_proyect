# Repository Guidelines

## Project Structure & Module Organization
Core code lives in `src/`. The battle engine is under `src/battle/`, shared domain types are in `src/domain/`, scenario and roster data are in `src/data/`, and higher-level game assembly is in `src/game/`. The CLI entrypoint is `src/index.ts`. Tests live in `tests/`, currently centered on `tests/battle.test.ts`. Build output is generated into `dist/`; treat that directory as compiled artifact, not source.

## Build, Test, and Development Commands
- `npm install`: install Node 18+ dependencies.
- `npm run dev`: run the entrypoint with `tsx` in watch mode for local iteration.
- `npm run start`: execute `src/index.ts` once without watch mode.
- `npm run build`: compile TypeScript with `tsc` into `dist/`.
- `npm test`: run the Vitest suite once.

Run `npm run build && npm test` before opening a PR when you touch engine logic or shared types.

## Coding Style & Naming Conventions
This repo uses strict TypeScript with ESM modules. Keep imports using `.js` specifiers in source files, matching the current `NodeNext` setup. Follow the existing style: 2-space indentation, double quotes, trailing commas where multiline formatting already uses them, and `PascalCase` for type/domain files such as `BattleEngine.ts` or `CharacterDefinition.ts`. Use `camelCase` for variables/functions and descriptive IDs like `winnerTeamId` or `battleId`.

## Testing Guidelines
Vitest is the test runner. Add or update tests in `tests/*.test.ts`; mirror the current pattern of grouping behavior with `describe()` and naming cases with clear present-tense statements such as `"poison deals damage on turn start"`. Favor behavior tests around battle flow, status effects, targeting, and scenario simulation. Keep coverage strongest around `src/battle/` because that is the highest-risk logic.

## Commit & Pull Request Guidelines
Git history is minimal (`First Commit`, `comit`), so use a clearer standard going forward: short imperative commit subjects such as `Add stun validation to battle engine`. Keep commits focused. PRs should include a concise summary, note any gameplay or data-model changes, link related issues when applicable, and include sample console output if `src/index.ts` behavior changes.

## Generated Files
Do not hand-edit `dist/` unless the task specifically requires generated output to be committed. Prefer changing `src/` or `tests/`, then rebuilding.
