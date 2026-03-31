// Homecast Expression Engine - Parser
// Recursive descent parser: tokens -> AST
// Operator precedence (low to high): ternary, or, and, equality, comparison, additive, multiplicative, unary, postfix

import { TokenType } from './ExpressionLexer';
import type { Token } from './ExpressionLexer';

// ============================================================
// AST Node Types
// ============================================================

export type ASTNode =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral
  | Identifier
  | BinaryOp
  | UnaryOp
  | FunctionCall
  | MemberAccess
  | IndexAccess
  | Ternary
  | ArrayLiteral;

export interface NumberLiteral { type: 'number'; value: number }
export interface StringLiteral { type: 'string'; value: string }
export interface BooleanLiteral { type: 'boolean'; value: boolean }
export interface NullLiteral { type: 'null' }
export interface Identifier { type: 'identifier'; name: string }

export interface BinaryOp {
  type: 'binary';
  op: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';
  left: ASTNode;
  right: ASTNode;
}

export interface UnaryOp {
  type: 'unary';
  op: '-' | '!';
  operand: ASTNode;
}

export interface FunctionCall {
  type: 'call';
  callee: string;
  args: ASTNode[];
}

export interface MemberAccess {
  type: 'member';
  object: ASTNode;
  property: string;
}

export interface IndexAccess {
  type: 'index';
  object: ASTNode;
  index: ASTNode;
}

export interface Ternary {
  type: 'ternary';
  condition: ASTNode;
  consequent: ASTNode;
  alternate: ASTNode;
}

export interface ArrayLiteral {
  type: 'array';
  elements: ASTNode[];
}

// ============================================================
// Parser
// ============================================================

/**
 * Recursive descent parser with standard operator precedence.
 */
export class ExpressionParser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(tokens: Token[]): ASTNode {
    this.tokens = tokens;
    this.pos = 0;
    const node = this.parseTernary();
    if (this.peek().type !== TokenType.EOF) {
      throw new Error(`Unexpected token '${this.peek().value}' at position ${this.peek().position}`);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: '', position: -1 };
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Expected ${TokenType[type]} but got '${token.value}' at position ${token.position}`);
    }
    return this.advance();
  }

  // ternary: or ('?' or ':' or)?
  private parseTernary(): ASTNode {
    let node = this.parseOr();

    if (this.peek().type === TokenType.Question) {
      this.advance();
      const consequent = this.parseTernary();
      this.expect(TokenType.Colon);
      const alternate = this.parseTernary();
      node = { type: 'ternary', condition: node, consequent, alternate };
    }

    return node;
  }

  // or: and ('||' and)*
  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.peek().type === TokenType.Or) {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'binary', op: '||', left, right };
    }
    return left;
  }

  // and: equality ('&&' equality)*
  private parseAnd(): ASTNode {
    let left = this.parseEquality();
    while (this.peek().type === TokenType.And) {
      this.advance();
      const right = this.parseEquality();
      left = { type: 'binary', op: '&&', left, right };
    }
    return left;
  }

  // equality: comparison (('==' | '!=') comparison)*
  private parseEquality(): ASTNode {
    let left = this.parseComparison();
    while (this.peek().type === TokenType.EqualEqual || this.peek().type === TokenType.NotEqual) {
      const op = this.advance().type === TokenType.EqualEqual ? '==' : '!=';
      const right = this.parseComparison();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // comparison: additive (('<' | '<=' | '>' | '>=') additive)*
  private parseComparison(): ASTNode {
    let left = this.parseAdditive();
    while (
      this.peek().type === TokenType.Less ||
      this.peek().type === TokenType.LessEqual ||
      this.peek().type === TokenType.Greater ||
      this.peek().type === TokenType.GreaterEqual
    ) {
      const token = this.advance();
      let op: '<' | '<=' | '>' | '>=';
      switch (token.type) {
        case TokenType.Less: op = '<'; break;
        case TokenType.LessEqual: op = '<='; break;
        case TokenType.Greater: op = '>'; break;
        default: op = '>=';
      }
      const right = this.parseAdditive();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // additive: multiplicative (('+' | '-') multiplicative)*
  private parseAdditive(): ASTNode {
    let left = this.parseMultiplicative();
    while (this.peek().type === TokenType.Plus || this.peek().type === TokenType.Minus) {
      const op = this.advance().type === TokenType.Plus ? '+' : '-';
      const right = this.parseMultiplicative();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // multiplicative: unary (('*' | '/' | '%') unary)*
  private parseMultiplicative(): ASTNode {
    let left = this.parseUnary();
    while (
      this.peek().type === TokenType.Star ||
      this.peek().type === TokenType.Slash ||
      this.peek().type === TokenType.Percent
    ) {
      const token = this.advance();
      let op: '*' | '/' | '%';
      switch (token.type) {
        case TokenType.Star: op = '*'; break;
        case TokenType.Slash: op = '/'; break;
        default: op = '%';
      }
      const right = this.parseUnary();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // unary: ('-' | '!') unary | postfix
  private parseUnary(): ASTNode {
    if (this.peek().type === TokenType.Minus) {
      this.advance();
      return { type: 'unary', op: '-', operand: this.parseUnary() };
    }
    if (this.peek().type === TokenType.Not) {
      this.advance();
      return { type: 'unary', op: '!', operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  // postfix: primary ('.' ident | '[' expr ']' | '(' args ')')*
  private parsePostfix(): ASTNode {
    let node = this.parsePrimary();

    while (true) {
      if (this.peek().type === TokenType.Dot) {
        this.advance();
        const prop = this.expect(TokenType.Identifier);
        node = { type: 'member', object: node, property: prop.value };
      } else if (this.peek().type === TokenType.LeftBracket) {
        this.advance();
        const index = this.parseTernary();
        this.expect(TokenType.RightBracket);
        node = { type: 'index', object: node, index };
      } else if (this.peek().type === TokenType.LeftParen && node.type === 'identifier') {
        // Function call
        node = this.parseFunctionCall(node.name);
      } else if (this.peek().type === TokenType.LeftParen && node.type === 'member') {
        // Method call: obj.method() -> function call with name "obj.method"
        // Flatten member chain into dotted name
        const name = this.flattenMemberName(node);
        if (name) {
          node = this.parseFunctionCall(name);
        } else {
          break;
        }
      } else {
        break;
      }
    }

    return node;
  }

  private parseFunctionCall(name: string): FunctionCall {
    this.expect(TokenType.LeftParen);
    const args: ASTNode[] = [];

    if (this.peek().type !== TokenType.RightParen) {
      args.push(this.parseTernary());
      while (this.peek().type === TokenType.Comma) {
        this.advance();
        args.push(this.parseTernary());
      }
    }

    this.expect(TokenType.RightParen);
    return { type: 'call', callee: name, args };
  }

  // primary: number | string | boolean | null | identifier | '(' expr ')' | '[' elements ']'
  private parsePrimary(): ASTNode {
    const token = this.peek();

    switch (token.type) {
      case TokenType.Number:
        this.advance();
        return { type: 'number', value: parseFloat(token.value) };

      case TokenType.String:
        this.advance();
        return { type: 'string', value: token.value };

      case TokenType.Boolean:
        this.advance();
        return { type: 'boolean', value: token.value === 'true' };

      case TokenType.Null:
        this.advance();
        return { type: 'null' };

      case TokenType.Identifier:
        this.advance();
        return { type: 'identifier', name: token.value };

      case TokenType.LeftParen: {
        this.advance();
        const expr = this.parseTernary();
        this.expect(TokenType.RightParen);
        return expr;
      }

      case TokenType.LeftBracket: {
        // Array literal: [a, b, c]
        this.advance();
        const elements: ASTNode[] = [];
        if (this.peek().type !== TokenType.RightBracket) {
          elements.push(this.parseTernary());
          while (this.peek().type === TokenType.Comma) {
            this.advance();
            elements.push(this.parseTernary());
          }
        }
        this.expect(TokenType.RightBracket);
        return { type: 'array', elements };
      }

      default:
        throw new Error(`Unexpected token '${token.value}' at position ${token.position}`);
    }
  }

  /**
   * Flatten a member access chain into a dotted string name.
   * E.g., { type: 'member', object: { type: 'identifier', name: 'now' }, property: 'hour' }
   * becomes "now.hour"
   */
  private flattenMemberName(node: ASTNode): string | null {
    if (node.type === 'identifier') return node.name;
    if (node.type === 'member') {
      const obj = this.flattenMemberName(node.object);
      if (obj) return `${obj}.${node.property}`;
    }
    return null;
  }
}
