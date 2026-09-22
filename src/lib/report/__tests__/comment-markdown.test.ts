import { describe, it, expect } from 'vitest';

import { readComment, inlineSpans, type Block } from '../comment-markdown';

/**
 * Reading a comment as it was meant to be read.
 *
 * Fed the shapes the routine actually writes — hard-wrapped prose, `##`
 * headings, numbered asks, fenced measurements — because the raw text on a
 * phone was the thing that made the answer unreadable.
 */

const text = (block: Block) =>
  'spans' in block ? block.spans.map((s) => s.text).join('') : '';

describe('reading one comment', () => {
  it('reflows a hard-wrapped paragraph into one, as markdown means it', () => {
    const [block] = readComment(
      'Two of the three asks are fixed in homecast-web#222.\n'
      + 'The third — the one in your title — I have diagnosed but deliberately\n'
      + 'not changed.',
    );
    expect(block.kind).toBe('paragraph');
    expect(text(block)).toBe(
      'Two of the three asks are fixed in homecast-web#222. The third — the one in your '
      + 'title — I have diagnosed but deliberately not changed.',
    );
  });

  it('keeps a blank line as a paragraph break', () => {
    const blocks = readComment('First thing.\n\nSecond thing.');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
    expect(blocks.map(text)).toEqual(['First thing.', 'Second thing.']);
  });

  it('reads a heading as a heading rather than leaving ## on the screen', () => {
    const [block] = readComment('## Ask 1 — the widget light/dark treatment\n');
    expect(block).toEqual({
      kind: 'heading', level: 2,
      spans: [{ text: 'Ask 1 — the widget light/dark treatment' }],
    });
  });

  it('gathers the numbered asks into one list, wrapped lines included', () => {
    const [block] = readComment(
      '1. **The widget treatment** does not switch at the right point\nagainst the background.\n'
      + '2. Not enough options are visible.\n',
    );
    expect(block.kind).toBe('list');
    if (block.kind !== 'list') return;
    expect(block.ordered).toBe(true);
    expect(block.items).toHaveLength(2);
    expect(block.items[0].map((s) => s.text).join('')).toBe(
      'The widget treatment does not switch at the right point against the background.',
    );
    expect(block.items[0][0].bold).toBe(true);
  });

  it('keeps a fenced measurement verbatim, line breaks and all', () => {
    const blocks = readComment('Here is the number.\n\n```\nbefore 235px\nafter  321px\n```\n\nAnd the cause.');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'code', 'paragraph']);
    const code = blocks[1];
    expect(code.kind === 'code' && code.text).toBe('before 235px\nafter  321px');
  });

  it('reads a quote of the code it is citing', () => {
    const [block] = readComment('> This app calls a wallpaper "dark" below 0.8.');
    expect(block.kind).toBe('quote');
    expect(text(block)).toBe('This app calls a wallpaper "dark" below 0.8.');
  });

  it('is empty for an empty comment', () => {
    expect(readComment('')).toEqual([]);
    expect(readComment('\n\n')).toEqual([]);
  });
});

describe('the runs inside a line', () => {
  it('reads emphasis, code and a link that keeps its address', () => {
    expect(inlineSpans('a background as dark below **0.8**, and `isDarkLuminance` says so')).toEqual([
      { text: 'a background as dark below ' },
      { text: '0.8', bold: true },
      { text: ', and ' },
      { text: 'isDarkLuminance', code: true },
      { text: ' says so' },
    ]);
    expect(inlineSpans('see [the write-up](https://example.test/x)')).toEqual([
      { text: 'see the write-up (https://example.test/x)' },
    ]);
    expect(inlineSpans('[https://example.test/x](https://example.test/x)')).toEqual([
      { text: 'https://example.test/x' },
    ]);
  });

  it('reads italics both ways without eating a snake_case name', () => {
    expect(inlineSpans('the *ink* decision')[1]).toEqual({ text: 'ink', italic: true });
    expect(inlineSpans('_deliberate_ and load-bearing')[0]).toEqual({ text: 'deliberate', italic: true });
    expect(inlineSpans('set widget_tint_mode to 1')).toEqual([{ text: 'set widget_tint_mode to 1' }]);
  });

  it('leaves a bare URL alone', () => {
    expect(inlineSpans('fixed in https://github.com/parob/homecast-web/pull/222.')).toEqual([
      { text: 'fixed in https://github.com/parob/homecast-web/pull/222.' },
    ]);
  });
});
