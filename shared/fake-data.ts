import type { AgentView, ClaimView, MemberView, MessageView, PlantView } from './types.ts';

const now = Date.now();
export const fakeMembers: MemberView[] = [
  { handle: 'trisha', color: '#e76f51', online: true, paused: false, lastSeen: now },
  { handle: 'alex', color: '#2a9d8f', online: true, paused: false, lastSeen: now },
];
export const fakeAgents: AgentView[] = [
  { sessionId: 's1', handle: 'trisha', kind: 'claude', status: 'working', currentPath: 'src/api/routes.ts', currentAction: 'edit', lastSeen: now },
];
export const fakePlants: PlantView[] = [
  { path: 'src/api/routes.ts', bed: 'src', lines: 120, stage: 'growing', bugs: 0, lastActivity: now, lastTouchedBy: 'trisha' },
  { path: 'tests/api.test.ts', bed: 'tests', lines: 60, stage: 'sprout', bugs: 2, lastActivity: now },
  { path: 'README.md', bed: '.', lines: 20, stage: 'bloom', bugs: 0, lastActivity: now, lastBloomAt: now },
];
export const fakeClaims: ClaimView[] = [
  { id: 1, path: 'src/api/', handle: 'trisha', createdAt: now, expiresAt: now + 30 * 60_000 },
];
export const fakeMessages: MessageView[] = [
  { id: 1, fromHandle: 'trisha', toHandle: 'alex', kind: 'finding', body: 'API route shape changed.', status: 'sent', sentAt: now },
];
