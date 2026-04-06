// Homecast Expression Engine - Evaluator
// Walks the AST and evaluates against a context

import type { ASTNode } from './ExpressionParser';
import type { ExpressionContext, BuiltinFunction } from './functions';

/**
 * Evaluates an AST against an expression context.
 * Safe: no access to window, document, or prototype chains.
 */
export class ExpressionEvaluator {
  constructor(private functions: Map<string, BuiltinFunction>) {}

  evaluate(node: ASTNode, ctx: ExpressionContext): unknown {
    switch (node.type) {
      case 'number': return node.value;
      case 'string': return node.value;
      case 'boolean': return node.value;
      case 'null': return null;
      case 'identifier': return this.resolveIdentifier(node.name, ctx);
      case 'binary': return this.evaluateBinary(node, ctx);
      case 'unary': return this.evaluateUnary(node, ctx);
      case 'call': return this.evaluateCall(node, ctx);
      case 'member': return this.evaluateMember(node, ctx);
      case 'index': return this.evaluateIndex(node, ctx);
      case 'ternary': return this.evaluateTernary(node, ctx);
      case 'array': return node.elements.map((e) => this.evaluate(e, ctx));
      default:
        throw new Error(`Unknown AST node type: ${(node as ASTNode).type}`);
    }
  }

  // ============================================================
  // Identifiers
  // ============================================================

  private resolveIdentifier(name: string, ctx: ExpressionContext): unknown {
    // Check variables first
    if (name in ctx.variables) return ctx.variables[name];

    // Built-in identifiers
    switch (name) {
      case 'trigger': return {
        id: ctx.triggerData.triggerId,
        type: ctx.triggerData.triggerType,
        from_value: ctx.triggerData.fromValue,
        to_value: ctx.triggerData.toValue,
        accessory_id: ctx.triggerData.accessoryId,
        characteristic_type: ctx.triggerData.characteristicType,
        event_type: ctx.triggerData.eventType,
        event_data: ctx.triggerData.eventData,
        webhook_payload: ctx.triggerData.webhookPayload,
        timestamp: ctx.triggerData.timestamp,
      };
      case 'repeat': return ctx.repeat;
      case 'wait': return ctx.wait;
      case 'variables': return ctx.variables;
      case 'nodes': return ctx.nodes ?? {};
    }

    // Zero-arg function call (e.g., `now` without parens evaluates to `now()`)
    const fn = this.functions.get(name);
    if (fn) return fn([], ctx);

    return undefined;
  }

  // ============================================================
  // Binary operators
  // ============================================================

  private evaluateBinary(
    node: { op: string; left: ASTNode; right: ASTNode },
    ctx: ExpressionContext,
  ): unknown {
    // Short-circuit for && and ||
    if (node.op === '&&') {
      const left = this.evaluate(node.left, ctx);
      if (!this.isTruthy(left)) return left;
      return this.evaluate(node.right, ctx);
    }
    if (node.op === '||') {
      const left = this.evaluate(node.left, ctx);
      if (this.isTruthy(left)) return left;
      return this.evaluate(node.right, ctx);
    }

    const left = this.evaluate(node.left, ctx);
    const right = this.evaluate(node.right, ctx);

    switch (node.op) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left ?? '') + String(right ?? '');
        }
        return this.toNumber(left) + this.toNumber(right);
      case '-': return this.toNumber(left) - this.toNumber(right);
      case '*': return this.toNumber(left) * this.toNumber(right);
      case '/': {
        const d = this.toNumber(right);
        return d === 0 ? 0 : this.toNumber(left) / d;
      }
      case '%': {
        const d = this.toNumber(right);
        return d === 0 ? 0 : this.toNumber(left) % d;
      }
      case '==': return this.looseEqual(left, right);
      case '!=': return !this.looseEqual(left, right);
      case '<': return this.toNumber(left) < this.toNumber(right);
      case '<=': return this.toNumber(left) <= this.toNumber(right);
      case '>': return this.toNumber(left) > this.toNumber(right);
      case '>=': return this.toNumber(left) >= this.toNumber(right);
      default:
        throw new Error(`Unknown binary operator: ${node.op}`);
    }
  }

  // ============================================================
  // Unary operators
  // ============================================================

  private evaluateUnary(
    node: { op: string; operand: ASTNode },
    ctx: ExpressionContext,
  ): unknown {
    const val = this.evaluate(node.operand, ctx);
    switch (node.op) {
      case '-': return -this.toNumber(val);
      case '!': return !this.isTruthy(val);
      default: throw new Error(`Unknown unary operator: ${node.op}`);
    }
  }

  // ============================================================
  // Function calls
  // ============================================================

  private evaluateCall(
    node: { callee: string; args: ASTNode[] },
    ctx: ExpressionContext,
  ): unknown {
    const fn = this.functions.get(node.callee);
    if (!fn) {
      throw new Error(`Unknown function: ${node.callee}`);
    }

    const args = node.args.map((a) => this.evaluate(a, ctx));
    return fn(args, ctx);
  }

  // ============================================================
  // Member access (obj.property)
  // ============================================================

  private evaluateMember(
    node: { object: ASTNode; property: string },
    ctx: ExpressionContext,
  ): unknown {
    const obj = this.evaluate(node.object, ctx);
    if (obj === null || obj === undefined) return undefined;

    if (typeof obj === 'object' && !Array.isArray(obj)) {
      return (obj as Record<string, unknown>)[node.property];
    }

    // String/array length
    if (node.property === 'length') {
      if (typeof obj === 'string') return obj.length;
      if (Array.isArray(obj)) return obj.length;
    }

    return undefined;
  }

  // ============================================================
  // Index access (obj[key])
  // ============================================================

  private evaluateIndex(
    node: { object: ASTNode; index: ASTNode },
    ctx: ExpressionContext,
  ): unknown {
    const obj = this.evaluate(node.object, ctx);
    const idx = this.evaluate(node.index, ctx);

    if (obj === null || obj === undefined) return undefined;

    if (Array.isArray(obj)) {
      const i = typeof idx === 'number' ? idx : parseInt(String(idx), 10);
      return isNaN(i) ? undefined : obj[i];
    }

    if (typeof obj === 'object') {
      return (obj as Record<string, unknown>)[String(idx)];
    }

    if (typeof obj === 'string') {
      const i = typeof idx === 'number' ? idx : parseInt(String(idx), 10);
      return isNaN(i) ? undefined : obj[i];
    }

    return undefined;
  }

  // ============================================================
  // Ternary
  // ============================================================

  private evaluateTernary(
    node: { condition: ASTNode; consequent: ASTNode; alternate: ASTNode },
    ctx: ExpressionContext,
  ): unknown {
    return this.isTruthy(this.evaluate(node.condition, ctx))
      ? this.evaluate(node.consequent, ctx)
      : this.evaluate(node.alternate, ctx);
  }

  // ============================================================
  // Type helpers
  // ============================================================

  private isTruthy(val: unknown): boolean {
    if (val === false || val === 0 || val === '' || val === null || val === undefined) return false;
    if (val === 'false' || val === '0') return false;
    return true;
  }

  private toNumber(val: unknown): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'string') {
      const n = Number(val);
      return isNaN(n) ? 0 : n;
    }
    return 0;
  }

  private looseEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null && b === undefined) return true;
    if (a === undefined && b === null) return true;
    // String comparison fallback (handles HomeKit number-as-string)
    if (String(a) === String(b)) return true;
    return false;
  }
}
