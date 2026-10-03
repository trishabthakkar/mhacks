import type { ActivityKind } from '../../../shared/types.ts';

/** The 8-step demo from PROJECT_CONTEXT.md section 13. `needs` = activity kinds that prove the step happened. */
export interface CueStep { id: number; name: string; say: string; needs: readonly ActivityKind[]; mode?: 'timelapse' }
export const CUE_STEPS: readonly CueStep[] = [
  { id: 0, name: 'Hook', say: 'Running agents as a team: nobody knows whose agent is touching what.', needs: [] },
  { id: 1, name: 'The garden', say: 'Beds are folders, plants are files, bots are Claude Code sessions.', needs: ['session_start'] },
  { id: 2, name: 'Live work', say: "A asks Claude for a feature: the bot fences src/api and tends it.", needs: ['claim', 'edit'] },
  { id: 3, name: 'Subagent', say: 'A subagent launches: a bee flies off and returns.', needs: ['subagent_start'] },
  { id: 4, name: 'Collision blocked', say: "B's agent tries a fenced file: blocked, then asks instead.", needs: ['blocked_edit'] },
  { id: 5, name: 'Cross-agent message', say: "A's finding reaches B's next prompt: butterfly lands.", needs: ['message_sent', 'message_delivered'] },
  { id: 6, name: 'The botanist', say: 'Refused with no tests; tests pass; the plant blooms.', needs: ['certify_refused', 'test_pass', 'certify_bloom'] },
  { id: 7, name: 'Close', say: 'Seasons timelapse: bare soil to full bloom.', needs: [], mode: 'timelapse' },
];

const done = new Set<string>(); // kinds seen since reset
let manual = new Set<number>(); // steps ticked by hand (click)

export function resetCue() { done.clear(); manual = new Set(); }
export function seen(kind: ActivityKind) { done.add(kind); }

function hasProgress(step: CueStep) { return manual.has(step.id) || step.needs.some((k) => done.has(k)); }

export function stepState(step: CueStep): 'done' | 'partial' | 'todo' {
  if (manual.has(step.id)) return 'done';
  // Narration-only steps (the hook) count as done once anything later has started.
  if (!step.needs.length) return !step.mode && CUE_STEPS.some((s) => s.id > step.id && hasProgress(s)) ? 'done' : 'todo';
  const hit = step.needs.filter((k) => done.has(k)).length;
  return hit === step.needs.length ? 'done' : hit > 0 ? 'partial' : 'todo';
}

/** First step that is not done yet. */
export function currentStep(): CueStep | undefined { return CUE_STEPS.find((s) => stepState(s) !== 'done'); }

export function toggleManual(id: number) { if (manual.has(id)) manual.delete(id); else manual.add(id); }

export function renderCue(el: HTMLElement) {
  const cur = currentStep();
  el.innerHTML = `<div class="cue-steps" role="list">${CUE_STEPS.map((s) => {
    const st = stepState(s), isCur = cur?.id === s.id;
    return `<button role="listitem" class="cue ${st}${isCur ? ' cur' : ''}" data-cue="${s.id}" title="${s.say.replace(/"/g, '&quot;')}">${st === 'done' ? '✓' : s.id + 1} ${s.name}</button>`;
  }).join('')}<button class="cue reset" data-cue-reset aria-label="Reset the cue strip">reset</button></div>
  ${cur ? `<div class="cue-say"><b>Now:</b> ${cur.say}</div>` : '<div class="cue-say"><b>All steps done.</b> Nice run.</div>'}`;
}
