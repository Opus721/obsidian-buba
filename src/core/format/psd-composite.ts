// Merged image of a PSD or PSB, downscaled for a preview: Photoshop's embedded thumbnail is at most 160 px
// (thumbnail.ts), while a file saved with "Maximize compatibility" (on by default) also keeps the whole picture
// flattened in its last section, "Image data" (Adobe Photoshop File Formats Specification). Only the slices
// the preview needs are read: the header, the lengths of the sections before it, the compression and the RLE
// row table, then the rows of each output band, at most `ROWS_PER_BAND` per band, merged into spans where
// rows lie close. RGB, grayscale and CMYK at 8 and 16 bits; other modes, 32 bits, ZIP compression, a picture
// of one flat color (a file saved without "Maximize compatibility" keeps a white one there) or a read past the
// limits give `null`, and the tile keeps the thumbnail. The file is untrusted: no length from it may point
// past the file size, and row data is checked while it is unpacked. No `obsidian` import and no DOM; the
// reading function is passed in.

/** Reads the file slice `[begin, end)`. */
export type ReadSlice = (begin: number, end: number) => Promise<Uint8Array>;

/** The downscaled merged image: RGBA pixels of `outWidth × outHeight`, and the document size. */
export interface Composite {
  readonly width: number;
  readonly height: number;
  readonly outWidth: number;
  readonly outHeight: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
}

/** Document side: PSD up to 30,000, PSB up to 300,000. */
const PSD_SIDE = 30000;
const PSB_SIDE = 300000;
/** Source rows averaged into one output row: enough to smooth a downscale, few enough to read little. */
export const ROWS_PER_BAND = 4;
/** Rows closer than this are read in one span. */
const GAP = 64 * 1024;
/** One span is at most this long. */
const SPAN_MAX = 8 * 1024 * 1024;
/** More than this is not read for a preview: a huge PSB keeps its thumbnail. */
export const COMPOSITE_MAX_BYTES = 256 * 1024 * 1024;
/** More slices than this are not requested. */
export const COMPOSITE_MAX_READS = 4096;
/** An RLE row table longer than this means a broken file. */
const TABLE_MAX = 64 * 1024 * 1024;

const GRAY = 1;
const RGB = 3;
const CMYK = 4;
/** Channels the merged image of each supported mode uses, in file order. */
const USED: Readonly<Record<number, number>> = { [GRAY]: 1, [RGB]: 3, [CMYK]: 4 };

const u16 = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;
const u32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

/** Reads `[begin, end)` if it lies inside the file and comes back whole. */
async function slice(read: ReadSlice, begin: number, end: number, size: number): Promise<Uint8Array | null> {
  if (!(begin >= 0 && end > begin && end <= size)) return null;
  const bytes = await read(begin, end);
  return bytes.length === end - begin ? bytes : null;
}

/** PackBits row from `src[from, to)` into `out`; `false` if the row does not fill `out` exactly. */
export function unpackRow(src: Uint8Array, from: number, to: number, out: Uint8Array): boolean {
  let i = from;
  let o = 0;
  while (i < to && o < out.length) {
    const n = src[i++]!;
    if (n < 128) {
      const length = n + 1;
      if (i + length > to || o + length > out.length) return false;
      out.set(src.subarray(i, i + length), o);
      i += length;
      o += length;
    } else if (n > 128) {
      const length = 257 - n;
      if (i >= to || o + length > out.length) return false;
      out.fill(src[i++]!, o, o + length);
      o += length;
    }
  }
  return o === out.length;
}

/** For each output band, up to `ROWS_PER_BAND` source rows spread evenly over it. */
export function bandRows(height: number, outHeight: number): number[][] {
  const bands: number[][] = [];
  for (let band = 0; band < outHeight; band++) {
    const top = Math.floor((band * height) / outHeight);
    const bottom = Math.max(top + 1, Math.floor(((band + 1) * height) / outHeight));
    const count = Math.min(ROWS_PER_BAND, bottom - top);
    const rows: number[] = [];
    for (let k = 0; k < count; k++) rows.push(top + Math.floor(((k + 0.5) * (bottom - top)) / count));
    bands.push(rows);
  }
  return bands;
}

/** Spans `[begin, end)` covering `extents` (sorted by begin), joined where the gap is under `GAP`. */
function spansOf(extents: readonly (readonly [number, number])[]): [number, number][] {
  const spans: [number, number][] = [];
  for (const [begin, end] of extents) {
    const last = spans.at(-1);
    if (last && begin - last[1] < GAP && end - last[0] <= SPAN_MAX) last[1] = Math.max(last[1], end);
    else spans.push([begin, end]);
  }
  return spans;
}

/**
 * The merged image of the PSD or PSB of `size` bytes, fitted into `maxSide`, or `null` (see the header). A
 * read failure throws.
 */
export async function readComposite(
  read: ReadSlice,
  size: number,
  maxSide: number,
): Promise<Composite | null> {
  const head = await slice(read, 0, 30, size);
  if (!head || String.fromCharCode(...head.subarray(0, 4)) !== '8BPS') return null;
  const version = u16(head, 4);
  if (version !== 1 && version !== 2) return null;
  const channels = u16(head, 12);
  const height = u32(head, 14);
  const width = u32(head, 18);
  const depth = u16(head, 22);
  const mode = u16(head, 24);
  const side = version === 1 ? PSD_SIDE : PSB_SIDE;
  const used = USED[mode];
  if (!used || channels < used || channels > 56) return null;
  if (!(width >= 1 && height >= 1 && width <= side && height <= side)) return null;
  if (depth !== 8 && depth !== 16) return null;

  // Color mode data, image resources, layer and mask information: each is its length and its bytes.
  let at = 30 + u32(head, 26);
  const resources = await slice(read, at, at + 4, size);
  if (!resources) return null;
  at += 4 + u32(resources, 0);
  const lengthBytes = version === 1 ? 4 : 8;
  const layers = await slice(read, at, at + lengthBytes, size);
  if (!layers) return null;
  const high = version === 1 ? 0 : u32(layers, 0);
  if (high >= 1 << 21) return null;
  at += lengthBytes + high * 2 ** 32 + u32(layers, version === 1 ? 0 : 4);
  const compressionBytes = await slice(read, at, at + 2, size);
  if (!compressionBytes) return null;
  const compression = u16(compressionBytes, 0);
  at += 2;

  const bytesPerSample = depth / 8;
  const rowBytes = width * bytesPerSample;
  /** Where row `y` of channel `c` lies in the file. */
  let extent: (c: number, y: number) => readonly [number, number];
  if (compression === 0) {
    if (at + used * height * rowBytes > size) return null;
    extent = (c, y) => {
      const begin = at + (c * height + y) * rowBytes;
      return [begin, begin + rowBytes];
    };
  } else if (compression === 1) {
    const countBytes = version === 1 ? 2 : 4;
    const tableLength = channels * height * countBytes;
    if (tableLength > TABLE_MAX) return null;
    // Only the counts of the used channels are needed; they come first.
    const table = await slice(read, at, at + used * height * countBytes, size);
    if (!table) return null;
    const starts = new Float64Array(used * height + 1);
    starts[0] = at + tableLength;
    for (let n = 0; n < used * height; n++) {
      const count = countBytes === 2 ? u16(table, n * 2) : u32(table, n * 4);
      starts[n + 1] = starts[n]! + count;
    }
    if (starts[used * height]! > size) return null;
    extent = (c, y) => [starts[c * height + y]!, starts[c * height + y + 1]!];
  } else return null;

  const scale = Math.min(1, maxSide / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const bands = bandRows(height, outHeight);
  const bandOf = new Map<number, number>();
  bands.forEach((rows, band) => rows.forEach((row) => bandOf.set(row, band)));
  const rows = [...bandOf.keys()].sort((a, b) => a - b);
  const column = new Int32Array(width);
  const perColumn = new Float64Array(outWidth);
  for (let x = 0; x < width; x++) {
    column[x] = Math.min(outWidth - 1, Math.floor((x * outWidth) / width));
    perColumn[column[x]!]! += 1;
  }

  const plan = Array.from({ length: used }, (_, c) => spansOf(rows.map((y) => extent(c, y))));
  let total = 0;
  let reads = 0;
  for (const spans of plan)
    for (const [begin, end] of spans) {
      total += end - begin;
      reads += 1;
    }
  if (total > COMPOSITE_MAX_BYTES || reads > COMPOSITE_MAX_READS) return null;

  const sums = Array.from({ length: used }, () => new Float64Array(outWidth * outHeight));
  const row = new Uint8Array(rowBytes);
  for (let c = 0; c < used; c++) {
    const sum = sums[c]!;
    let next = 0;
    for (const [begin, end] of plan[c]!) {
      const bytes = await slice(read, begin, end, size);
      if (!bytes) return null;
      for (; next < rows.length; next++) {
        const y = rows[next]!;
        const [from, to] = extent(c, y);
        if (from >= end) break;
        if (compression === 1) {
          if (!unpackRow(bytes, from - begin, to - begin, row)) return null;
        } else row.set(bytes.subarray(from - begin, to - begin));
        const base = bandOf.get(y)! * outWidth;
        // 16 bits: the high byte of each big-endian sample.
        for (let x = 0; x < width; x++) sum[base + column[x]!]! += row[x * bytesPerSample]!;
      }
    }
  }

  const pixels = new Uint8ClampedArray(outWidth * outHeight * 4);
  const value = (c: number, at: number, band: number): number =>
    sums[c]![at]! / (perColumn[at % outWidth]! * bands[band]!.length);
  let varied = false;
  for (let band = 0; band < outHeight; band++)
    for (let x = 0; x < outWidth; x++) {
      const at = band * outWidth + x;
      let r: number;
      let g: number;
      let b: number;
      if (mode === GRAY) r = g = b = value(0, at, band);
      else if (mode === RGB) [r, g, b] = [value(0, at, band), value(1, at, band), value(2, at, band)];
      else {
        // Photoshop keeps CMYK inverted: 255 is no ink.
        const k = value(3, at, band) / 255;
        [r, g, b] = [value(0, at, band) * k, value(1, at, band) * k, value(2, at, band) * k];
      }
      pixels.set([r, g, b, 255], at * 4);
      varied ||= Math.abs(pixels[0]! - pixels[at * 4]!) > 1 || Math.abs(pixels[1]! - pixels[at * 4 + 1]!) > 1;
      varied ||= Math.abs(pixels[2]! - pixels[at * 4 + 2]!) > 1;
    }
  if (!varied) return null;
  return { width, height, outWidth, outHeight, pixels };
}
