// Team code: base64url JSON {stdbUri, db, mcpUrl, color?} (CONTRACT.md).
export interface TeamCode { stdbUri: string; db: string; mcpUrl: string; color?: string }

export function makeTeamCode(c: TeamCode): string {
  const o: TeamCode = { stdbUri: c.stdbUri, db: c.db, mcpUrl: c.mcpUrl };
  if (c.color) o.color = c.color;
  return Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
}

export function parseTeamCode(code: string): TeamCode {
  let o: unknown;
  try {
    o = JSON.parse(Buffer.from(code.trim(), 'base64url').toString('utf8'));
  } catch {
    throw new Error('team code is not valid base64url JSON');
  }
  const c = o as Partial<TeamCode>;
  if (!c || typeof c.stdbUri !== 'string' || typeof c.db !== 'string' || typeof c.mcpUrl !== 'string') {
    throw new Error('team code must contain stdbUri, db and mcpUrl');
  }
  return { stdbUri: c.stdbUri, db: c.db, mcpUrl: c.mcpUrl, ...(typeof c.color === 'string' ? { color: c.color } : {}) };
}
