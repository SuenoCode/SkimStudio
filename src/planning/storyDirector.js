/**
 * Story Director workflow coordinator.
 *
 * This module deliberately contains no editing heuristics or mega-prompt. It
 * sequences the editor's existing analysis, evidence, planning and compiler
 * functions, and leaves each decision in the service that already owns it.
 */
const REQUIRED_STAGES = ['analyzeScript', 'analyzeFootage', 'prepareEvidence', 'matchFootage'];

const TOOL_DESCRIPTIONS = Object.freeze({
  analyzeScript: 'Analyze narration into ordered story beats.',
  analyzeFootage: 'Detect shots and local motion, then annotate sampled subjects and visual evidence.',
  buildStoryEdit: 'Create a validated EDL from the matched shots using SkimStudio timing and trim rules, then stage it for review.',
  validateTimeline: 'Validate a timeline against the selected source clips.',
  render: 'Encode the currently applied timeline to MP4 and run SkimStudio export verification.',
  auditExportWithOpenRouter: 'Audit an exported video against its script using OpenRouter.',
  applyTimelineFix: 'Apply a reviewed repair timeline through the editor approval flow.',
  exportAuditReport: 'Download the latest story audit as Markdown.',
  prepareEvidence: 'Prepare candidate shots and representative source frames.',
  matchFootage: 'Match story beats to the analyzed source footage.',
  auditAgainstScript: 'Audit sampled frames from an exported MP4 against its script.',
  repairProblems: 'Create a reviewed repair proposal from audit findings.',
});

/**
 * Register only named editor operations. Model output is data, never a command,
 * path, or file operation. The Story Director has no filesystem or shell tool;
 * writes happen only through SkimStudio's explicit, user-facing export flows.
 */
export function createStoryDirectorTools(implementations = {}) {
  const registered = new Map();
  for (const [name, description] of Object.entries(TOOL_DESCRIPTIONS)) {
    const execute = implementations[name];
    if (execute != null && typeof execute !== 'function') {
      throw new TypeError(`Story Director tool ${name} must be a function.`);
    }
    if (typeof execute === 'function') registered.set(name, { name, description, execute });
  }
  return Object.freeze({
    list: () => [...registered.values()].map(({ name, description }) => ({ name, description })),
    has: name => registered.has(name),
    async call(name, input = {}, { signal } = {}) {
      const tool = registered.get(name);
      if (!tool) throw new Error(`Story Director cannot call unregistered tool: ${name}`);
      if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled.', 'AbortError');
      return tool.execute(input, { signal });
    },
  });
}

export async function runStoryDirector({
  script,
  context = {},
  tools,
  signal,
  onStage = () => {},
} = {}) {
  if (typeof script !== 'string' || !script.trim()) {
    throw new Error('Add a narration script before starting the Story Director.');
  }
  for (const name of REQUIRED_STAGES) {
    if (!tools?.has?.(name)) {
      throw new TypeError(`Story Director is missing the ${name} tool.`);
    }
  }

  const trace = [];
  const state = { ...context, script: script.trim() };
  for (let index = 0; index < REQUIRED_STAGES.length; index++) {
    if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled.', 'AbortError');
    const name = REQUIRED_STAGES[index];
    onStage({ name, index, total: REQUIRED_STAGES.length, state });
    const startedAt = Date.now();
    const result = await tools.call(name, state, { signal });
    if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled.', 'AbortError');
    if (result && typeof result === 'object' && !Array.isArray(result)) Object.assign(state, result);
    trace.push({ name, durationMs: Date.now() - startedAt });
  }
  return { ...state, trace };
}

/** Run a later workflow stage that needs the host editor's existing compiler. */
export async function runStoryDirectorStage({ name, state, run, signal, onStage = () => {} } = {}) {
  if (typeof name !== 'string' || !name.trim() || typeof run !== 'function') {
    throw new TypeError('A Story Director stage name and runner are required.');
  }
  if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled.', 'AbortError');
  onStage({ name, state });
  const startedAt = Date.now();
  const tools = createStoryDirectorTools({ [name]: run });
  const result = await tools.call(name, state, { signal });
  if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled.', 'AbortError');
  return { result, trace: { name, durationMs: Date.now() - startedAt } };
}
