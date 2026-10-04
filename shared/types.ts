import type {
  ACTIVITY_KINDS, AGENT_STATUSES, HANDOFF_STATUSES, MESSAGE_KINDS, MESSAGE_STATUSES, PLANT_STAGES,
  TASK_ITEM_STATES, TASK_STATUSES,
} from './constants.ts';

export type PlantStage = (typeof PLANT_STAGES)[number];
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskItemState = (typeof TASK_ITEM_STATES)[number];

// View-model types for the garden. Field names match the generated client rows exactly (camelCase).
// Converting a generated row: u64 ids are bigint → Number(id); Timestamp → ts.toDate().getTime() (ms);
// option columns are already `T | undefined`. Table accessors: conn.db.member … conn.db.testRun.
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

export interface ActivityView {
  id: number; at: number; handle: string; sessionId?: string; kind: ActivityKind; path?: string; detail: string;
}
export interface TestRunView { id: number; handle: string; repo: string; command: string; exitCode: number; at: number }
export interface CertificationView {
  id: number; path: string; handle: string; task: string; result: 'bloom' | 'refused'; reason: string; at: number;
}

/** One frame of the garden: everything the browser would hold from SpacetimeDB at time `at`. */
export interface GardenSnapshot {
  at: number;
  members: MemberView[];
  agents: AgentView[];
  plants: PlantView[];
  claims: ClaimView[];
  messages: MessageView[];
  testRuns: TestRunView[];
  certifications: CertificationView[];
  activity: ActivityView[];
  /** Optional: absent in older snapshots and in the fake timeline. */
  handoffs?: HandoffView[];
  /** Optional: absent in snapshots from before tasks existed. */
  tasks?: TaskView[];
  taskItems?: TaskItemView[];
}

/** A task an agent named (claim_files) or started from its to-do list. Times in ms. */
export interface TaskView {
  id: number; handle: string; title: string; status: TaskStatus; bed: string; paths: string[];
  blockedReason?: string; createdAt: number; updatedAt: number; doneAt?: number;
}
export interface TaskItemView { id: number; taskId: number; ord: number; text: string; state: TaskItemState }

export interface HandoffView {
  id: number; fromHandle: string; toHandle: string; task: string; notes: string; status: HandoffStatus; createdAt: number;
}
