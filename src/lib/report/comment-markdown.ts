/**
 * Reading a comment the way it was meant to be read.
 *
 * What arrives from the server is Markdown, because that is what was typed
 * into GitHub. Shown as-is it is worse than useless on a phone: the routine
 * hard-wraps its prose at about 80 columns, so `whitespace-pre-wrap` breaks
 * every line mid-sentence, and `## Ask 1`, `**not**` and `` `isDarkLuminance` ``
 * are left as punctuation for the reader to parse. A reporter who came back to
 * read the answer should not have to.
 *
 * So: the smallest parser that makes the answers this screen actually shows
 * legible — paragraphs with their soft wraps reflowed (a single newline is a
 * space, a blank line is a break, which is Markdown's own rule), headings,
 * bullet and numbered lists, fenced code kept verbatim, and inline emphasis,
 * code and links. Nothing more: this is a reader, not an editor, and anything
 * it does not recognise falls through as the text that was written.
 *
 * It returns a structure rather than HTML on purpose. These are comments from
 * GitHub — `dangerouslySetInnerHTML` over them would be an injection route
 * into the app, so the view builds elements from this and no markup survives
 * the trip.
 */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { kind: 'heading'; level: number; spans: Inline[] }
  | { kind: 'paragraph'; spans: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; spans: Inline[] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*```/;

/**
 * The runs of emphasis, code and links in one line of prose.
 *
 * One pass, no nesting: `**bold**`, `*italic*`, `_italic_`, `` `code` `` and
 * `[text](url)`. A link keeps its address — "nothing leaves the app without
 * saying where it goes" is this screen's rule, and a bare `text` would drop
 * the one thing a reader might want to follow.
 */
export function inlineSpans(line: string): Inline[] {
  const spans: Inline[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])|\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  let at = 0;
  let match: RegExpExecArray | null;

  const plain = (text: string) => {
    if (text) spans.push({ text });
  };

  while ((match = pattern.exec(line)) !== null) {
    plain(line.slice(at, match.index));
    const [, code, boldStar, boldBar, italicStar, italicBar, linkText, linkUrl] = match;
    if (code !== undefined) spans.push({ text: code, code: true });
    else if (boldStar !== undefined) spans.push({ text: boldStar, bold: true });
    else if (boldBar !== undefined) spans.push({ text: boldBar, bold: true });
    else if (italicStar !== undefined) spans.push({ text: italicStar, italic: true });
    else if (italicBar !== undefined) spans.push({ text: italicBar, italic: true });
    else if (linkUrl !== undefined) {
      const label = (linkText || '').trim();
      plain(label && label !== linkUrl ? `${label} (${linkUrl})` : linkUrl);
    }
    at = match.index + match[0].length;
  }
  plain(line.slice(at));
  return merged(spans);
}

/** Adjacent runs in the same style are one run: a link's label and the prose
 *  around it would otherwise arrive as three spans saying one sentence. */
function merged(spans: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (
      last
      && Boolean(last.bold) === Boolean(span.bold)
      && Boolean(last.italic) === Boolean(span.italic)
      && Boolean(last.code) === Boolean(span.code)
    ) {
      last.text += span.text;
      continue;
    }
    out.push({ ...span });
  }
  return out.length > 0 ? out : [{ text: '' }];
}

const spansOf = (lines: string[]): Inline[] => inlineSpans(lines.join(' ').replace(/\s+/g, ' ').trim());

/** One comment as blocks, in order. */
export function readComment(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const endParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', spans: spansOf(paragraph) });
    paragraph = [];
  };
  const endQuote = () => {
    if (quote.length) blocks.push({ kind: 'quote', spans: spansOf(quote) });
    quote = [];
  };
  const endList = () => {
    if (list) {
      blocks.push({
        kind: 'list',
        ordered: list.ordered,
        items: list.items.map((item) => inlineSpans(item)),
      });
    }
    list = null;
  };
  const endAll = () => { endParagraph(); endQuote(); endList(); };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (FENCE.test(line)) {
      endAll();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      const code = body.join('\n').replace(/\s+$/, '');
      if (code) blocks.push({ kind: 'code', text: code });
      continue;
    }

    if (!line.trim()) {
      endAll();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      endAll();
      blocks.push({ kind: 'heading', level: heading[1].length, spans: inlineSpans(heading[2].trim()) });
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      endParagraph(); endList();
      quote.push(quoted[1]);
      continue;
    }
    endQuote();

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      endParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) { endList(); list = { ordered, items: [] }; }
      list.items.push((bullet ? bullet[1] : numbered![1]).trim());
      continue;
    }

    // A wrapped continuation of the item above, not a new paragraph.
    if (list) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    paragraph.push(line);
  }

  endAll();
  return blocks;
}
