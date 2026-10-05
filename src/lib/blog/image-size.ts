/**
 * Reads an image's pixel size from its header bytes — PNG, JPEG, WebP or SVG.
 *
 * The blog gives every figure a width and height so the page doesn't jump as
 * images arrive, and those come from the files themselves at build time. This
 * takes bytes rather than a path so it stays free of `fs` and testable with a
 * literal; it returns undefined for anything it doesn't recognise rather than
 * guessing, since a wrong aspect ratio is worse than none.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const u16be = (o: number) => (bytes[o] << 8) | bytes[o + 1];
  const u16le = (o: number) => bytes[o] | (bytes[o + 1] << 8);
  const u24le = (o: number) => bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
  const u32be = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));

  // PNG: the IHDR chunk is always first.
  if (bytes.length >= 24 && ascii(1, 3) === 'PNG') {
    return { width: u32be(16), height: u32be(20) };
  }

  // WebP: RIFF container, three encodings.
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (kind === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (kind === 'VP8L') {
      const b = (o: number) => bytes[21 + o];
      return {
        width: 1 + (((b(1) & 0x3f) << 8) | b(0)),
        height: 1 + (((b(3) & 0xf) << 10) | (b(2) << 2) | ((b(1) & 0xc0) >> 6)),
      };
    }
    return undefined;
  }

  // JPEG: walk the segments to the first start-of-frame.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) return undefined;
      const marker = bytes[o + 1];
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) return { width: u16be(o + 7), height: u16be(o + 5) };
      o += 2 + u16be(o + 2);
    }
    return undefined;
  }

  // SVG: width/height attributes, else the viewBox.
  const head = new TextDecoder().decode(bytes.subarray(0, 2048));
  const svg = head.match(/<svg\b[^>]*>/i)?.[0];
  if (svg) {
    const attr = (name: string) => svg.match(new RegExp(`\\s${name}="([\\d.]+)(px)?"`))?.[1];
    const w = attr('width');
    const h = attr('height');
    if (w && h) return { width: Math.round(+w), height: Math.round(+h) };
    const vb = svg.match(/viewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/);
    if (vb) return { width: Math.round(+vb[1]), height: Math.round(+vb[2]) };
  }
  return undefined;
}
