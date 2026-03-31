// Homecast Automation Engine - Script Runner
// Executes reusable scripts with modes: single, restart, queued, parallel

import type { Script, TriggerData, ScriptMode } from '../types/automation';
import type { ExecutionTrace, ExecutionStatus } from '../types/execution';
import { ExecutionContext } from './ExecutionContext';
import type { ActionExecutor } from './ActionExecutor';
import { StopExecutionError } from './ActionExecutor';

/**
 * Manages script execution with concurrency modes.
 */
export class ScriptRunner {
  private scripts = new Map<string, Script>();
  private runningContexts = new Map<string, ExecutionContext[]>();
  private queues = new Map<string, Array<{ variables?: Record<string, unknown>; resolve: (result?: Record<string, unknown>) => void; reject: (err: Error) => void }>>();

  constructor(
    private actionExecutor: ActionExecutor,
    private onTraceComplete: (trace: ExecutionTrace) => void,
  ) {}

  /**
   * Load/reload all scripts.
   */
  loadScripts(scripts: Script[]): void {
    this.scripts.clear();
    for (const s of scripts) {
      this.scripts.set(s.id, s);
    }
  }

  updateScript(script: Script): void {
    this.scripts.set(script.id, script);
  }

  removeScript(scriptId: string): void {
    this.scripts.delete(scriptId);
    // Cancel running
    const running = this.runningContexts.get(scriptId);
    if (running) {
      for (const ctx of running) ctx.cancel();
      this.runningContexts.delete(scriptId);
    }
  }

  /**
   * Execute a script by ID. Returns the response variable if the script sets one.
   */
  async execute(
    scriptId: string,
    variables?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const script = this.scripts.get(scriptId);
    if (!script) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    const running = this.runningContexts.get(scriptId) ?? [];

    switch (script.mode) {
      case 'single':
        if (running.length > 0) {
          throw new Error(`Script ${script.name} is already running (mode: single)`);
        }
        break;

      case 'restart':
        for (const ctx of running) ctx.cancel();
        this.runningContexts.set(scriptId, []);
        break;

      case 'queued': {
        const max = script.maxRunning ?? 10;
        if (running.length >= max) {
          // Queue it
          return new Promise((resolve, reject) => {
            let queue = this.queues.get(scriptId);
            if (!queue) {
              queue = [];
              this.queues.set(scriptId, queue);
            }
            queue.push({ variables, resolve, reject });
          });
        }
        break;
      }

      case 'parallel': {
        const max = script.maxRunning ?? 10;
        if (running.length >= max) {
          throw new Error(`Script ${script.name} max parallel runs reached (${max})`);
        }
        break;
      }
    }

    return this.runScript(script, variables);
  }

  private async runScript(
    script: Script,
    variables?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const triggerData: TriggerData = {
      triggerId: '__script__',
      triggerType: 'event',
      eventType: 'script_call',
      timestamp: Date.now(),
    };

    const mergedVars = { ...script.variables, ...variables };
    const ctx = new ExecutionContext(script.id, script.name, triggerData, mergedVars);

    // Track running
    let running = this.runningContexts.get(script.id);
    if (!running) {
      running = [];
      this.runningContexts.set(script.id, running);
    }
    running.push(ctx);

    let status: ExecutionStatus = 'success';
    let error: string | undefined;
    let responseData: Record<string, unknown> | undefined;

    try {
      await this.actionExecutor.executeSequence(script.actions, ctx);
    } catch (e) {
      if (e instanceof StopExecutionError) {
        status = e.isError ? 'error' : 'stopped';
        error = e.reason;
        // Capture response variable
        if (e.responseVariable) {
          responseData = ctx.variables as Record<string, unknown>;
        }
      } else {
        status = 'error';
        error = String(e);
      }
    } finally {
      // Remove from running
      const idx = running.indexOf(ctx);
      if (idx >= 0) running.splice(idx, 1);
      if (running.length === 0) this.runningContexts.delete(script.id);

      // Emit trace
      this.onTraceComplete(ctx.buildTrace(status, error));

      // Process queue
      this.processQueue(script.id);
    }

    return responseData;
  }

  private processQueue(scriptId: string): void {
    const queue = this.queues.get(scriptId);
    if (!queue || queue.length === 0) return;

    const next = queue.shift()!;
    if (queue.length === 0) this.queues.delete(scriptId);

    this.execute(scriptId, next.variables)
      .then(next.resolve)
      .catch(next.reject);
  }

  getScript(id: string): Script | undefined {
    return this.scripts.get(id);
  }

  getAllScripts(): Script[] {
    return Array.from(this.scripts.values());
  }

  isRunning(scriptId: string): boolean {
    const running = this.runningContexts.get(scriptId);
    return running !== undefined && running.length > 0;
  }

  teardown(): void {
    for (const running of this.runningContexts.values()) {
      for (const ctx of running) ctx.cancel();
    }
    this.runningContexts.clear();
    this.queues.clear();
    this.scripts.clear();
  }
}
