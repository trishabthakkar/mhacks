// Git feed: post-commit hook payload + a 5s poll of `git diff` per joined repo, so edits
// made in normal editors (not just Claude Code) count as real diffs for the botanist.
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { JoinedRepo } from './config.ts';

export function git(cwd: string, args: string[], timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/** Paths changed vs HEAD (staged + unstaged) plus untracked, non-ignored files. */
export async function dirtyPaths(root: string): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    git(root, ['diff', '--name-only', 'HEAD']).catch(() => git(root, ['diff', '--name-only'])), // no HEAD yet
    git(root, ['ls-files', '--others', '--exclude-standard']),
  ]);
  return [...new Set([...lines(tracked), ...lines(untracked).slice(0, 500)])];
}

export async function commitInfo(root: string): Promise<{ sha: string; paths: string[] }> {
  const [sha, names] = await Promise.all([
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD']),
  ]);
  return { sha: sha.trim(), paths: lines(names) };
}

interface Seen { sig: number; reportedAt: number }

export class GitPoller {
  private seen = new Map<string, Map<string, Seen>>();
  private hookEdits = new Map<string, number>(); // `${repo}\0${path}` → ms
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private repos: () => JoinedRepo[],
    private onDiff: (repo: JoinedRepo, paths: string[]) => void,
    private onFileChange: (repo: JoinedRepo, path: string) => void,
    private intervalMs = 5000,
    private resendAfterMs = 30_000,
  ) {}

  /** A Claude Code edit just touched this path: don't double-report it as file_change. */
  noteHookEdit(repoName: string, path: string): void {
    this.hookEdits.set(`${repoName}\0${path}`, Date.now());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollAll(), this.intervalMs);
    this.timer.unref?.();
    void this.pollAll();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async pollAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const r of this.repos()) await this.pollRepo(r).catch(() => {});
    } finally {
      this.running = false;
    }
  }

  async pollRepo(repo: JoinedRepo): Promise<string[]> {
    const now = Date.now();
    const dirty = await dirtyPaths(repo.root);
    const prev = this.seen.get(repo.root) ?? new Map<string, Seen>();
    const next = new Map<string, Seen>();
    const changed: string[] = [];
    for (const p of dirty) {
      let sig = 0;
      try { sig = statSync(join(repo.root, p)).mtimeMs; } catch { sig = -1; } // deleted
      const old = prev.get(p);
      if (!old || (old.sig !== sig && now - old.reportedAt >= this.resendAfterMs)) {
        changed.push(p);
        next.set(p, { sig, reportedAt: now });
      } else {
        next.set(p, old);
      }
    }
    this.seen.set(repo.root, next);
    for (const [k, t] of this.hookEdits) if (now - t > 60_000) this.hookEdits.delete(k);
    if (changed.length) {
      this.onDiff(repo, changed);
      let n = 0;
      for (const p of changed) {
        const t = this.hookEdits.get(`${repo.name}\0${p}`);
        if (t && now - t < 15_000) continue;
        if (n++ >= 10) break;
        this.onFileChange(repo, p);
      }
    }
    return changed;
  }
}
