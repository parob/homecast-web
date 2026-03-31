// Homecast Expression Engine - Lexer
// Tokenizes expression strings into a stream of typed tokens

export enum TokenType {
  // Literals
  Number,
  String,
  Boolean,
  Null,

  // Identifiers and keywords
  Identifier,   // variable names, function names
  Dot,          // .

  // Operators
  Plus,         // +
  Minus,        // -
  Star,         // *
  Slash,        // /
  Percent,      // %
  EqualEqual,   // ==
  NotEqual,     // !=
  Less,         // <
  LessEqual,    // <=
  Greater,      // >
  GreaterEqual, // >=
  And,          // && or 'and'
  Or,           // || or 'or'
  Not,          // ! or 'not'

  // Delimiters
  LeftParen,    // (
  RightParen,   // )
  LeftBracket,  // [
  RightBracket, // ]
  Comma,        // ,
  Question,     // ?
  Colon,        // :

  // End
  EOF,
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const KEYWORDS: Record<string, TokenType> = {
  'true': TokenType.Boolean,
  'false': TokenType.Boolean,
  'null': TokenType.Null,
  'none': TokenType.Null,
  'and': TokenType.And,
  'or': TokenType.Or,
  'not': TokenType.Not,
};

/**
 * Tokenizes an expression string into a sequence of tokens.
 * Safe: no eval, no access to globals.
 */
export class ExpressionLexer {
  private source: string;
  private pos = 0;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;

    while (this.pos < this.source.length) {
      this.skipWhitespace();
      if (this.pos >= this.source.length) break;

      const ch = this.source[this.pos];

      // Numbers
      if (this.isDigit(ch) || (ch === '.' && this.pos + 1 < this.source.length && this.isDigit(this.source[this.pos + 1]))) {
        this.readNumber();
        continue;
      }

      // Strings (single or double quoted)
      if (ch === "'" || ch === '"') {
        this.readString(ch);
        continue;
      }

      // Identifiers and keywords
      if (this.isIdentStart(ch)) {
        this.readIdentifier();
        continue;
      }

      // Two-character operators
      if (this.pos + 1 < this.source.length) {
        const two = this.source.slice(this.pos, this.pos + 2);
        const twoCharOp = this.twoCharOperator(two);
        if (twoCharOp !== null) {
          this.tokens.push({ type: twoCharOp, value: two, position: this.pos });
          this.pos += 2;
          continue;
        }
      }

      // Single-character operators and delimiters
      const singleOp = this.singleCharOperator(ch);
      if (singleOp !== null) {
        this.tokens.push({ type: singleOp, value: ch, position: this.pos });
        this.pos++;
        continue;
      }

      throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
    }

    this.tokens.push({ type: TokenType.EOF, value: '', position: this.pos });
    return this.tokens;
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.pos++;
    }
  }

  private readNumber(): void {
    const start = this.pos;
    let hasDot = false;

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (this.isDigit(ch)) {
        this.pos++;
      } else if (ch === '.' && !hasDot) {
        hasDot = true;
        this.pos++;
      } else {
        break;
      }
    }

    this.tokens.push({
      type: TokenType.Number,
      value: this.source.slice(start, this.pos),
      position: start,
    });
  }

  private readString(quote: string): void {
    const start = this.pos;
    this.pos++; // skip opening quote

    let value = '';
    while (this.pos < this.source.length && this.source[this.pos] !== quote) {
      if (this.source[this.pos] === '\\' && this.pos + 1 < this.source.length) {
        this.pos++;
        const escaped = this.source[this.pos];
        switch (escaped) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case '\\': value += '\\'; break;
          default: value += escaped;
        }
      } else {
        value += this.source[this.pos];
      }
      this.pos++;
    }

    if (this.pos >= this.source.length) {
      throw new Error(`Unterminated string starting at position ${start}`);
    }
    this.pos++; // skip closing quote

    this.tokens.push({ type: TokenType.String, value, position: start });
  }

  private readIdentifier(): void {
    const start = this.pos;
    while (this.pos < this.source.length && this.isIdentPart(this.source[this.pos])) {
      this.pos++;
    }

    const word = this.source.slice(start, this.pos);
    const keyword = KEYWORDS[word];

    this.tokens.push({
      type: keyword ?? TokenType.Identifier,
      value: word,
      position: start,
    });
  }

  private twoCharOperator(s: string): TokenType | null {
    switch (s) {
      case '==': return TokenType.EqualEqual;
      case '!=': return TokenType.NotEqual;
      case '<=': return TokenType.LessEqual;
      case '>=': return TokenType.GreaterEqual;
      case '&&': return TokenType.And;
      case '||': return TokenType.Or;
      default: return null;
    }
  }

  private singleCharOperator(ch: string): TokenType | null {
    switch (ch) {
      case '+': return TokenType.Plus;
      case '-': return TokenType.Minus;
      case '*': return TokenType.Star;
      case '/': return TokenType.Slash;
      case '%': return TokenType.Percent;
      case '<': return TokenType.Less;
      case '>': return TokenType.Greater;
      case '!': return TokenType.Not;
      case '(': return TokenType.LeftParen;
      case ')': return TokenType.RightParen;
      case '[': return TokenType.LeftBracket;
      case ']': return TokenType.RightBracket;
      case ',': return TokenType.Comma;
      case '.': return TokenType.Dot;
      case '?': return TokenType.Question;
      case ':': return TokenType.Colon;
      default: return null;
    }
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }
}
