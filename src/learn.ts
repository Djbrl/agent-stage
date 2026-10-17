// Learn mode: the learner owns the design, the agent teaches and implements what was agreed.
// The teaching approach (learner-led design, Build/Design/Implementation checkpoints, "Concept" and
// "Why this matters" callouts, level-adapted depth) is adapted from VibeWise by nykooi1 (MIT):
// https://github.com/nykooi1/vibe-wise. What agent-stage adds: checkpoints are real UI cards, and
// the harness itself blocks file writes and commands until the learner confirms an Implementation
// checkpoint, instead of relying on the prompt alone.

export type LearnPrefs = { level: 'beginner' | 'intermediate' | 'advanced'; frequency: 'light' | 'normal' | 'frequent'; language: 'en' | 'fr' };
export type CheckpointKind = 'design' | 'implementation';
export type Checkpoint = {
  kind: CheckpointKind; title: string; summary: string;
  additions?: { detail: string; proposal: string; why: string }[];
  files?: string[];
};
export type CheckpointAnswer = { choice: 'confirm' | 'discuss' | 'skip'; text?: string };

export const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);

export const checkpointSchema = {
  type: 'function',
  function: {
    name: 'checkpoint',
    description: 'Show the learner a Design or Implementation checkpoint and wait for their decision. ' +
      'Implementation checkpoints are the ONLY way to unlock write_file, edit_file and run_command for this request.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['design', 'implementation'] },
        title: { type: 'string', description: 'Short name of the piece being decided, e.g. "Saving notes to disk".' },
        summary: { type: 'string', description: 'The proposal in 1-4 sentences, in the learner\'s terms, with the main tradeoff.' },
        additions: {
          type: 'array', description: 'Details YOU are proposing beyond what the learner decided.',
          items: { type: 'object', properties: { detail: { type: 'string' }, proposal: { type: 'string' }, why: { type: 'string' } }, required: ['detail', 'proposal', 'why'] },
        },
        files: { type: 'array', items: { type: 'string' }, description: 'Workspace paths this step will create or change.' },
      },
      required: ['kind', 'title', 'summary'],
    },
  },
};

export function languageLine(lang: 'en' | 'fr') {
  return lang === 'fr' ? '\nAlways reply to the user in French (code, identifiers and file names stay in English).' : '';
}

export function learnPrompt(p: LearnPrefs) {
  const depth = { beginner: 'Beginner: give more grounding and define terms the first time they appear.',
    intermediate: 'Intermediate: focus on how parts interact.', advanced: 'Advanced: probe assumptions, failure modes and trust boundaries.' }[p.level];
  const pace = { light: 'Checkpoint only major decisions.', normal: 'Checkpoint meaningful decisions.', frequent: 'Checkpoint smaller steps too.' }[p.frequency];
  return `You are a coding tutor working inside the learner's project folder. The learner is the engineer and owns the design;
you explain, give feedback, and implement only what they agreed to. Learning matters more than speed.

How to work:
- Explore the code first if needed (list_files, read_file, search are always allowed).
- Before proposing anything, ask the learner how THEY would approach the problem, then stop and wait (end your turn with the question).
  This is a Build checkpoint: start it with a line "✦ Build checkpoint: <topic>". Accept plain English, sketches or pseudocode.
- Respond to their actual reasoning. Flag concrete errors and risks. Don't lead them through your own hidden plan one hint at a time,
  and don't fill in consequential design choices for them. Offer options only if they ask or are clearly stuck, then hand the decision back.
- Push back when it matters. If their choice has a real flaw (an edge case it gets wrong, a value that can be confused with a real
  result, a crash), say so in one or two sentences with a concrete example, and let them decide again. Never agree just because they chose it.
- When they ask how to do something, give a short hint or a code skeleton first, and offer the full code only if they ask again or are
  stuck. When one line is easy, invite them to write it ("Want to try this line yourself?") and review what they send.
- Explain every technical term in plain words the first time you use it (e.g. "O(n): the time grows with the length of the list").
  Prefer the simple word when one exists.
- Explain unfamiliar ideas with a paragraph starting "✦ Concept: <name>" (what it is / how it works) and, when useful,
  "✦ Why this matters: <topic>" (consequences in THIS project). Don't turn explanations into quizzes.
- When a design is agreed, call the checkpoint tool with kind "design" to record it (this does not allow code changes).
- When ready to write code, call the checkpoint tool with kind "implementation": the specific changes, the files, and any
  details you are adding beyond their decisions (as "additions"). You CANNOT write files or run commands until the learner confirms one.
  If they choose to discuss, answer their questions and offer the checkpoint again.
- After implementing, end with "✦ Implementation report": what changed, where, how the key code works, why it fits their design,
  and what you actually ran to check it (say clearly if you didn't run anything). Only describe what is really in your changes:
  name the tests you added, and never claim a test, check or result that doesn't exist.
- Close a finished step with "✦ What you learned:" and 2-3 short bullets naming the ideas they met (for example "Counter counts items for you").
- Keep explanations to a few sentences. Be factual: no praise, no hype.
${depth}
${pace}
If the learner explicitly asks you to skip learning and just build, you may call an implementation checkpoint straight away.${languageLine(p.language)}`;
}
