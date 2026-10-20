import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { brotliDecompressSync } from 'node:zlib';

// WOFF2 table tags by directory index (the cmap table is stored untransformed).
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep'];
function base128(view, at) {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    const byte = view.getUint8(at.offset++);
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error('Bad UIntBase128');
}
function cmapCodePoints(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const count = view.getUint16(12);
  const compressed = view.getUint32(20);
  const at = { offset: 48 };
  const tables = [];
  for (let index = 0; index < count; index++) {
    const flags = view.getUint8(at.offset++);
    const tag = (flags & 0x3f) === 0x3f ? String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(at.offset + i))) : KNOWN[flags & 0x3f];
    if ((flags & 0x3f) === 0x3f) at.offset += 4;
    const original = base128(view, at);
    const transformed = tag === 'glyf' || tag === 'loca' ? (flags >> 6) === 0 : (flags >> 6) !== 0;
    tables.push({ tag, length: transformed ? base128(view, at) : original });
  }
  const data = brotliDecompressSync(buffer.subarray(at.offset, at.offset + compressed));
  let start = 0;
  const cmap = tables.map((table) => { const entry = { ...table, start }; start += table.length; return entry; }).find((table) => table.tag === 'cmap');
  assert.ok(cmap, 'font has a cmap');
  const sfnt = new DataView(data.buffer, data.byteOffset + cmap.start, cmap.length);
  const points = new Set();
  for (let index = 0; index < sfnt.getUint16(2); index++) {
    const offset = sfnt.getUint32(4 + index * 8 + 4);
    const format = sfnt.getUint16(offset);
    if (format === 4) {
      // Resolve the glyph through idRangeOffset/idDelta; glyph 0 is .notdef, so such a code point is missing.
      const segments = sfnt.getUint16(offset + 6) / 2;
      const ends = offset + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
      for (let segment = 0; segment < segments; segment++) {
        const end = sfnt.getUint16(ends + segment * 2);
        if (end === 0xffff) continue;
        for (let point = sfnt.getUint16(starts + segment * 2); point <= end; point++) {
          const rangeOffset = sfnt.getUint16(ranges + segment * 2);
          const glyph = rangeOffset === 0 ? (point + sfnt.getInt16(deltas + segment * 2)) & 0xffff
            : (() => { const raw = sfnt.getUint16(ranges + segment * 2 + rangeOffset + (point - sfnt.getUint16(starts + segment * 2)) * 2); return raw === 0 ? 0 : (raw + sfnt.getInt16(deltas + segment * 2)) & 0xffff; })();
          if (glyph !== 0) points.add(point);
        }
      }
    } else if (format === 12) {
      for (let group = 0; group < sfnt.getUint32(offset + 12); group++) {
        const from = sfnt.getUint32(offset + 16 + group * 12);
        { const startGlyph = sfnt.getUint32(offset + 24 + group * 12); for (let point = from; point <= sfnt.getUint32(offset + 20 + group * 12); point++) if (startGlyph + point - from !== 0) points.add(point); }
      }
    }
  }
  return points;
}

test('every bundled caption face covers Polish, Czech, Slovak, Hungarian, Turkish and French text with the Latin and Latin-extended files together', async () => {
  const names = { Montserrat: ['montserrat', 'montserrat-ext'], Lora: ['lora', 'lora-ext'], 'Lora italic': ['lora-italic', 'lora-italic-ext'], 'Roboto Mono': ['roboto-mono', 'roboto-mono-ext'] };
  const text = 'Łukasz Řehoř Žlutý kůň Ďábelské ódy Ťažký Ňuňu Śćńźż ĄĘ Őű Çğışö Zoë São Paulo ça va “quoted” — £€';
  for (const [family, files] of Object.entries(names)) {
    const points = new Set();
    for (const file of files) for (const point of cmapCodePoints(await readFile(new URL(`../browser/${file}.woff2`, import.meta.url)))) points.add(point);
    const missing = [...new Set(text)].filter((glyph) => !points.has(glyph.codePointAt(0)));
    assert.deepEqual(missing, [], `${family} lacks ${missing.join(' ')}`);
    assert.equal(points.has(0x416), false, `${family}: the reader does report a missing glyph (Cyrillic)`);
  }
});
