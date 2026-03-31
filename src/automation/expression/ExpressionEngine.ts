// Homecast Expression Engine - Facade
// Single entry point: parse + evaluate expressions safely

import { ExpressionLexer } from './ExpressionLexer';
import { ExpressionParser } from './ExpressionParser';
import type { ASTNode } from './ExpressionParser';
import { ExpressionEvaluator } from './ExpressionEval';
import { createFunctionRegistry } from './functions';
import type { ExpressionContext } from './functions';
import type { StateStore } from '../state/StateStore';
import type { TriggerData } from '../types/automation';

export type { ExpressionContext } from './functions';

// Cache parsed ASTs for performance (expressions are often re-evaluated)
const astCache = new Map<string, ASTNode>();
const MAX_CACHE_SIZE = 500;

/**
 * Safe expression engine for the Homecast automation system.
 *
 * Syntax:
 *   states('ACC_ID', 'power_state') == 1
 *   states('ACC_ID', 'temperature') > 25 && now().hour >= 22
 *   helper('vacation_mode') == true
 *   trigger.from_value != trigger.to_value
 *   variables.counter + 1
 *   min(states('S1', 'temp'), states('S2', 'temp'))
 *   iif(now().hour < 6, 'night', 'day')
 *   mapper[repeat.item][0]
 */
export class ExpressionEngine {
  private parser = new ExpressionParser();
  private evaluator: ExpressionEvaluator;

  constructor() {
    const functions = createFunctionRegistry();
    this.evaluator = new ExpressionEvaluator(functions);
  }

  /**
   * Evaluate an expression string against the given context.
   */
  evaluate(expression: string, ctx: ExpressionContext): unknown {
    const ast = this.parse(expression);
    return this.evaluator.evaluate(ast, ctx);
  }

  /**
   * Evaluate an expression and return a boolean result.
   */
  evaluateBoolean(expression: string, ctx: ExpressionContext): boolean {
    const result = this.evaluate(expression, ctx);
    return this.isTruthy(result);
  }

  /**
   * Resolve template strings containing {{ expression }} blocks.
   * Non-template strings pass through unchanged.
   *
   * If the entire string is a single {{ expression }}, returns the raw value
   * (not stringified) for type preservation.
   */
  resolveTemplate(value: unknown, ctx: ExpressionContext): unknown {
    if (typeof value !== 'string') return value;
    if (!value.includes('{{')) return value;

    // Full template: "{{ expr }}" -> return raw value
    const fullMatch = value.match(/^\{\{\s*(.+?)\s*\}\}$/);
    if (fullMatch) {
      return this.evaluate(fullMatch[1], ctx);
    }

    // Partial template: "text {{ expr }} more text" -> string interpolation
    return value.replace(/\{\{\s*(.+?)\s*\}\}/g, (_match, expr: string) => {
      const resolved = this.evaluate(expr, ctx);
      return String(resolved ?? '');
    });
  }

  /**
   * Build an ExpressionContext from engine state.
   */
  static buildContext(
    stateStore: StateStore,
    triggerData: TriggerData,
    variables: Record<string, unknown>,
    repeat?: { index: number; first: boolean; last: boolean; item?: unknown },
    wait?: { completed: boolean; trigger?: TriggerData },
  ): ExpressionContext {
    return {
      stateStore,
      triggerData,
      variables,
      repeat: repeat ?? { index: 0, first: true, last: true },
      wait: wait ?? { completed: false },
    };
  }

  // ============================================================
  // Internal
  // ============================================================

  private parse(expression: string): ASTNode {
    // Check cache
    let ast = astCache.get(expression);
    if (ast) return ast;

    // Parse
    const lexer = new ExpressionLexer(expression);
    const tokens = lexer.tokenize();
    ast = this.parser.parse(tokens);

    // Cache (with eviction)
    if (astCache.size >= MAX_CACHE_SIZE) {
      const firstKey = astCache.keys().next().value;
      if (firstKey !== undefined) astCache.delete(firstKey);
    }
    astCache.set(expression, ast);

    return ast;
  }

  private isTruthy(val: unknown): boolean {
    if (val === false || val === 0 || val === '' || val === null || val === undefined) return false;
    if (val === 'false' || val === '0') return false;
    return true;
  }
}
