// Pure: tidy a task name or checklist step an agent wrote, so the garden reads like a list of commit subjects.
// Never rejects: callers still run their empty / length / secret checks on the result.
const CODEISH = /^\S*([/._(]|[a-z][A-Z])/; // starts with a path, file, call or camelCase name: keep its case

export function tidyTitle(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) { const m = /^(["'`])(.*)\1$/.exec(t); if (!m) break; t = m[2]!.trim(); }
  t = t.replace(/^`([^`]+)`/, '$1');
  t = t.replace(/(?<!\.)\.$/, '').trim();
  if (t && !CODEISH.test(t)) t = t[0]!.toUpperCase() + t.slice(1);
  return t;
}
