import vm from 'node:vm';
import type { AgentTool } from './types.js';

/**
 * Minimal JS sandbox using Node's built-in vm module. This is intentionally
 * limited — it runs pure JS for illustrating algorithm outputs, NOT for
 * executing student code. No network, no fs, no dynamic require.
 *
 * Hard budgets: 2s CPU, 512 KB output cap. Anything slower or larger aborts.
 * A future upgrade path is isolated-vm for multi-tenant isolation; for a
 * local-first tutor the vm module is sufficient and has zero install cost.
 */
export const runCodeTool: AgentTool<
  { code: string; input?: string },
  { stdout: string; stderr: string; durationMs: number; truncated: boolean }
> = {
  name: 'run_code',
  description:
    'Execute a SMALL pure-JavaScript snippet in an ephemeral sandbox and return its stdout. Use to illustrate algorithm output, never for student-submitted code.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string' },
      input: { type: 'string', description: 'Optional stdin-like string, available as `input`.' },
    },
    required: ['code'],
  },
  async run({ code, input }) {
    const MAX_OUTPUT = 512 * 1024;
    const started = Date.now();
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    let totalLen = 0;
    let truncated = false;

    const appendStdout = (...args: unknown[]) => {
      const s = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      if (totalLen + s.length > MAX_OUTPUT) {
        truncated = true;
        return;
      }
      totalLen += s.length;
      stdoutParts.push(s);
    };
    const appendStderr = (...args: unknown[]) => {
      const s = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      stderrParts.push(s);
    };

    const sandbox = {
      console: {
        log: (...a: unknown[]) => appendStdout(...a),
        error: (...a: unknown[]) => appendStderr(...a),
        warn: (...a: unknown[]) => appendStderr(...a),
      },
      input: input ?? '',
      Math,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Set,
      Map,
    };

    const ctx = vm.createContext(sandbox, { name: 'run_code' });

    try {
      const script = new vm.Script(String(code), { filename: 'snippet.js' });
      script.runInContext(ctx, { timeout: 2000, breakOnSigint: true });
    } catch (err) {
      stderrParts.push(err instanceof Error ? err.message : String(err));
    }

    return {
      stdout: stdoutParts.join('\n'),
      stderr: stderrParts.join('\n'),
      durationMs: Date.now() - started,
      truncated,
    };
  },
};
