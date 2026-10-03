import type {
  ACTIVITY_KINDS, AGENT_STATUSES, HANDOFF_STATUSES, MESSAGE_KINDS, MESSAGE_STATUSES, PLANT_STAGES,
} from './constants.ts';

export type PlantStage = (typeof PLANT_STAGES)[number];
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

// View-model types for the garden. Times are ms since epoch. TODO(contract): align with generated bindings.
export interface MemberView { handle: string; color: string; online: boolean; paused: boolean; lastSeen: number }
export interface AgentView {
  sessionId: string; handle: string; kind: 'claude' | 'subagent'; parentSessionId?: string;
  status: AgentStatus; currentPath?: string; currentAction: string; lastSeen: number;
}
export interface PlantView {
  path: string; bed: string; lines: number; stage: PlantStage; bugs: number; lastActivity: number;
  lastTouchedBy?: string; lastDiffAt?: number; lastBloomAt?: number;
}
export interface ClaimView { id: number; path: string; handle: string; createdAt: number; expiresAt: number }
export interface MessageView {
  id: number; fromHandle: string; fromSession?: string; toHandle: string; kind: MessageKind;
  body: string; status: MessageStatus; sentAt: number; deliveredAt?: number; ackedAt?: number;
}
