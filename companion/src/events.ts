// Wire format between hooks / shell / git and the local daemon (POST /event).
// Hooks already strip prompt text and contents; the daemon redacts again before sending.
import type { ActivityKind } from '../../shared/types.ts';

export type DaemonEvent =
  | {
      type: 'activity'; repo?: string; sessionId?: string; parentSessionId?: string;
      kind: ActivityKind; path?: string; lines?: number; detail?: string;
    }
  | { type: 'test_run'; repo: string; command: string; exitCode: number; sessionId?: string }
  | { type: 'diff'; repo: string; paths: string[]; commit?: string }
  /** Raw interactive shell command from shell-init (redacted by the daemon, never logged raw). */
  | { type: 'shell'; cmd: string; exitCode: number; cwd: string };

export interface InboxMessage { id: string; fromHandle: string; kind: string; body: string; sentAt: number }

/** A message to or from me, for `sprout inbox` / `sprout sent`. */
export interface MessageRow extends InboxMessage {
  toHandle: string; status: 'sent' | 'delivered' | 'acked'; deliveredAt?: number; ackedAt?: number;
}

/** GET /messages. `held`: waiting for my OK before my agent sees it (inbox mode `ask`). */
export interface MessagesView {
  me: string; mode: 'auto' | 'ask' | 'off'; connected: boolean;
  inbox: (MessageRow & { held: boolean })[];
  sent: MessageRow[];
}

export type CheckResult =
  | { fenced: false; mode: 'warn' | 'block' }
  | { fenced: true; mode: 'warn' | 'block'; holder: string; claimPath: string; expiresAt: number };

export interface DaemonStatus {
  handle: string; connected: boolean; impl: 'fake' | 'spacetimedb'; paused: boolean; claimMode: string;
  inbox: number; held: number; myClaims: { path: string; expiresAt: number }[]; recent: { at: number; text: string }[];
  queued: number; repos: string[];
}
