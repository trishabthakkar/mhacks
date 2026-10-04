// When a teammate's task blooms, one online teammate's companion congratulates them.
// Every daemon sees the same task row and member list, so they all agree on who sends:
// one compliment per finished task, rotating between teammates.

export const PHRASES = [
  'Yay!', 'You did it!', 'Nailed it!', 'Way to go!', 'Woohoo!', 'Great work!', 'High five!',
  'Look at that bloom!', 'Crushed it!', 'Brilliant!', 'So proud of you!', 'Another one blooms!',
] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Which online teammate (never the finisher) sends the compliment for this task. */
export function chooseComplimenter(online: string[], finisher: string, taskId: string): string | undefined {
  const pool = [...new Set(online)].filter((h) => h !== finisher).sort();
  return pool.length ? pool[hash(taskId) % pool.length] : undefined;
}

/** A phrase other than `last` (so back-to-back compliments differ), and the message body. */
export function compliment(finisher: string, title: string, last = -1, rand = Math.random): { body: string; phrase: number } {
  let phrase = Math.floor(rand() * PHRASES.length) % PHRASES.length;
  if (phrase === last) phrase = (phrase + 1) % PHRASES.length;
  const task = title.trim() ? `"${title.trim()}"` : 'your task';
  return { body: `${PHRASES[phrase]} ${finisher}, ${task} just bloomed 🌸`, phrase };
}
