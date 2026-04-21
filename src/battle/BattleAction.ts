export type BattleActionType = "basic_attack" | "skill";

export interface BattleAction {
  actionType: BattleActionType;
  actorId: string;
  targetId: string;
  skillId?: string;
  source?: "auto" | "manual";
  decisionNote?: string;
}
