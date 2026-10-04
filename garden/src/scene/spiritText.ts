/** Text in a spirit's thought bubble: what it is doing right now, short enough to read in 3D. */
export function spiritText(action: string, path: string | undefined): string {
  const s = path ? `${action} ${path.split('/').filter(Boolean).pop()}` : action;
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}
