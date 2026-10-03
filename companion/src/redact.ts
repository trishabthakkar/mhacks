// Everything that leaves the laptop passes through here (CLAUDE.md privacy rules).
// Never prompt text or file contents; commands → binary + subcommand unless they are
// test commands; secrets masked; paths repo-relative or dropped.
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { MAX_COMMAND, MAX_DETAIL, TEST_COMMAND_RE } from '../../shared/constants.ts';

const MASK = '***';

const SECRET_PATTERNS: [RegExp, string][] = [
  // URLs with credentials: scheme://user:pass@host or scheme://token@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(:[^\s/@]*)?@/gi, `$1${MASK}@`],
  // emails
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
  // Authorization headers / bearer tokens
  [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`],
  // well-known key formats
  [/\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{10,}/g, MASK],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, MASK],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, MASK],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, MASK],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, MASK], // JWT
  [/\b(?:npm|pypi|glpat|hf|shpat|sq0atp)[-_][A-Za-z0-9_-]{16,}/g, MASK],
  // key=value / key: value where the key smells secret
  [/\b([A-Za-z0-9_.-]*(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth|credential|session|cookie|signature)[A-Za-z0-9_.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&;,]+)/gi, `$1$2${MASK}`],
  // --password value / --token value / -p'value' style flags
  [/(--?(?:pass(?:word)?|token|secret|api-key|apikey|key|auth)(?:\s+|=))("[^"]*"|'[^']*'|\S+)/gi, `$1${MASK}`],
  // long hex (≥32) e.g. hashes-as-secrets, raw keys
  [/\b[0-9a-fA-F]{32,}\b/g, MASK],
];

/** Long base64-ish tokens with both letters and digits (no '/' or '.', so paths survive). */
function maskOpaqueTokens(s: string): string {
  return s.replace(/[A-Za-z0-9+_=-]{32,}/g, (tok) => (/[0-9]/.test(tok) && /[A-Za-z]/.test(tok) ? MASK : tok));
}

export function maskSecrets(s: string): string {
  let out = s;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return maskOpaqueTokens(out);
}

export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function isTestCommand(cmd: string): boolean {
  return TEST_COMMAND_RE.test(cmd);
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPERS = new Set(['sudo', 'time', 'nohup', 'env', 'command', 'exec', 'npx', 'bunx', 'pnpx']);
const SUBCOMMAND = /^[a-z][a-z0-9:_-]{0,24}$/;

/**
 * Test commands: up to MAX_COMMAND chars with secrets masked.
 * Anything else: binary + subcommand only (e.g. `git commit`, `curl`).
 */
export function redactCommand(raw: string): string {
  const cmd = raw.replace(/\s+/g, ' ').trim();
  if (!cmd) return '';
  if (isTestCommand(cmd)) return clip(maskSecrets(cmd), MAX_COMMAND);
  const toks = cmd.split(' ');
  let i = 0;
  while (i < toks.length && (ENV_ASSIGN.test(toks[i]!) || (WRAPPERS.has(toks[i]!) && i + 1 < toks.length))) i++;
  const binTok = toks[i];
  if (!binTok) return '';
  const bin = binTok.split('/').pop()!.replace(/[^A-Za-z0-9._+-]/g, '');
  if (!bin) return '';
  const next = toks[i + 1];
  const sub = next && SUBCOMMAND.test(next) ? ` ${next}` : '';
  return clip(maskSecrets(bin + sub), MAX_COMMAND);
}

/** Repo-relative POSIX path, or undefined if outside the repo (never leaves the laptop then). */
export function relPath(root: string, p: string | undefined, cwd = root): string | undefined {
  if (!p || typeof p !== 'string') return undefined;
  const abs = isAbsolute(p) ? resolve(p) : resolve(cwd, p);
  const rel = relative(resolve(root), abs);
  if (rel === '') return undefined;
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return rel.split(sep).join('/');
}

export function detail(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return clip(maskSecrets(s.replace(/\s+/g, ' ').trim()), MAX_DETAIL);
}
