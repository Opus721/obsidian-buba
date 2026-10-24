// Embedded thumbnail of PSD, PSB and AI from the file head: Photoshop stores a JPEG up to 160 px
// (image resource 1036), Illustrator a base64 JPEG up to 256 px in the XMP packet. The scanner
// gets the file head and size and answers "found" (JPEG and original size), "read up to byte N"
// or "no thumbnail". The file is untrusted (Sync, a file manager): no length from the file may
// point past what was read, past its section or past the file size, and memory is allocated only
// for what was read. No `obsidian` import; reading is in `src/platform/previews/head.ts`.

/** Thumbnail from the file: the JPEG and the original size. */
export interface Embedded {
  readonly jpeg: Uint8Array;
  /** PSD, PSB: the header's document size; AI: the `MaxPageSize` artboard in points or the thumbnail size. */
  readonly width: number;
  readonly height: number;
}

/**
 * Scanner answer: `found` is the thumbnail; `need` is how many bytes from the file start to read for the scan
 * to progress (more than read and at most the file size; the scanner does not know the exact place, so it
 * asks for the next byte); `null` means no thumbnail or a broken file.
 */
export type Scan = { readonly found: Embedded } | { readonly need: number } | null;

/** Scans the file head: `head` is the bytes read from the start, `size` the file size. */
export type Scanner = (head: Uint8Array, size: number) => Scan;

/** A larger JPEG is not a thumbnail. */
export const MAX_JPEG = 1 << 20;
/** A larger side is not a thumbnail: a SOF claiming 60,000 × 60,000 never reaches decoding. */
export const MAX_THUMB_SIDE = 1024;
/** Document side: PSD up to 30,000, PSB up to 300,000 (Adobe Photoshop File Formats Specification). */
const PSD_SIDE = 30000;
const PSB_SIDE = 300000;
/** More image resources than this means a broken or hostile file. */
const MAX_RESOURCES = 10000;
/** Thumbnail of Photoshop 5.0 and later: RGB JPEG. Resource 1033 (Photoshop 4, BGR) is not used. */
const THUMBNAIL = 1036;
/**
 * Fields of resource 1036 before the JPEG: format, width, height, bytes per row, full and compressed size,
 * bits per pixel, planes.
 */
const THUMBNAIL_FIELDS = 28;
const RESOURCE_SIGNATURES = new Set(['8BIM', 'MeSa', 'AgHg', 'PHUT', 'DCSR']);

const u16 = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;
const u32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const ascii = (b: Uint8Array, at: number, n: number): string =>
  String.fromCharCode(...b.subarray(at, at + n));

/** How far to read next: at least the next byte; past the file end there will be no thumbnail. */
function more(need: number, head: Uint8Array, size: number): Scan {
  const at = Math.max(need, head.length + 1);
  return at <= size ? { need: at } : null;
}

/** A thumbnail JPEG starts with SOI and its SOF frame size is 1 to `MAX_THUMB_SIDE` per side. */
function thumbnailSize(jpeg: Uint8Array): { width: number; height: number } | null {
  if (jpeg.length > MAX_JPEG) return null;
  const size = jpegSize(jpeg);
  if (!size || size.width > MAX_THUMB_SIDE || size.height > MAX_THUMB_SIDE) return null;
  return size;
}

/**
 * PSD (version 1) and PSB (version 2): a 26-byte header with signature `8BPS`, version, height at byte 14 and
 * width at byte 18; then color mode data with its length; then the image resources section with a 4-byte
 * length in both. A resource is signature, id, Pascal name padded to even, length, data padded to even. The
 * thumbnail is resource 1036; Photoshop writes it after XMP (1060) and ICC (1039).
 */
export function psdThumbnail(head: Uint8Array, size: number): Scan {
  if (size < 30) return null;
  if (head.length < 30) return more(30, head, size);
  if (ascii(head, 0, 4) !== '8BPS') return null;
  const version = u16(head, 4);
  if (version !== 1 && version !== 2) return null;
  const height = u32(head, 14);
  const width = u32(head, 18);
  const side = version === 1 ? PSD_SIDE : PSB_SIDE;
  if (width < 1 || height < 1 || width > side || height > side) return null;
  const sectionAt = 30 + u32(head, 26);
  // Color mode data longer than the file: `more` answers "no", there is nothing to read past the file.
  if (head.length < sectionAt + 4) return more(sectionAt + 4, head, size);
  const end = sectionAt + 4 + u32(head, sectionAt);
  if (end > size) return null;
  let at = sectionAt + 4;
  for (let count = 0; count < MAX_RESOURCES; count++) {
    // Signature, id, name length and data length need 12 bytes; fewer left in the section: no more resources.
    if (at + 12 > end) return null;
    if (head.length < at + 7) return more(at + 7, head, size);
    if (!RESOURCE_SIGNATURES.has(ascii(head, at, 4))) return null;
    const id = u16(head, at + 4);
    const name = 1 + head[at + 6]!;
    const lengthAt = at + 6 + name + (name % 2);
    if (lengthAt + 4 > end) return null;
    if (head.length < lengthAt + 4) return more(lengthAt + 4, head, size);
    const length = u32(head, lengthAt);
    const dataAt = lengthAt + 4;
    if (dataAt + length > end) return null;
    if (id === THUMBNAIL) {
      if (length < THUMBNAIL_FIELDS + 4 || length - THUMBNAIL_FIELDS > MAX_JPEG) return null;
      if (head.length < dataAt + length) return more(dataAt + length, head, size);
      const format = u32(head, dataAt);
      const thumbWidth = u32(head, dataAt + 4);
      const thumbHeight = u32(head, dataAt + 8);
      if (format !== 1 || thumbWidth < 1 || thumbHeight < 1) return null;
      if (thumbWidth > MAX_THUMB_SIDE || thumbHeight > MAX_THUMB_SIDE) return null;
      // The compressed size is a cross-check; if it disagrees with the resource length, the JPEG runs to the
      // end of the resource.
      const compressed = u32(head, dataAt + 20);
      const jpegLength =
        compressed > 0 && compressed <= length - THUMBNAIL_FIELDS ? compressed : length - THUMBNAIL_FIELDS;
      const jpeg = head.slice(dataAt + THUMBNAIL_FIELDS, dataAt + THUMBNAIL_FIELDS + jpegLength);
      if (!thumbnailSize(jpeg)) return null;
      return { found: { jpeg, width, height } };
    }
    at = dataAt + length + (length % 2);
  }
  return null;
}

/**
 * Illustrator's XMP packet is the second PDF object, right after the catalog (around byte 200): we do not
 * look past 64 KB, so a file without it there is settled as having no thumbnail in one chunk.
 */
const AI_PACKET_WITHIN = 65536;
const PACKET_BEGIN = '<?xpacket begin';
const PACKET_END = '<?xpacket end';
/** Thumbnail base64: as an element (CS3 and later, `xmpGImg`) or an attribute (CS1–CS2, `xapGImg`). */
const IMAGE = /<(xmpGImg|xapGImg):image>([^<]*)<\/\1:image>|\b(?:xmpGImg|xapGImg):image\s*=\s*"([^"]*)"/;
/** Line breaks Illustrator puts into base64: `&#xA;`, `&#xD;` and whitespace. */
const BREAKS = /&#(?:x[aAdD9]|1[03]|9);|\s+/g;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** If artboard and thumbnail proportions match within this, the original size is taken from the artboard. */
const RATIO_TOLERANCE = 0.02;
/** A larger artboard side is garbage (Illustrator's large canvas is 22,700 inches, 1,634,400 pt). */
const MAX_ARTBOARD = 2_000_000;
/** `stDim:unit` units in points: pt ≈ px at 72 dpi. */
const UNIT: Readonly<Record<string, number>> = {
  Points: 1,
  Pixels: 1,
  Inches: 72,
  Millimeters: 72 / 25.4,
  Centimeters: 72 / 2.54,
  Picas: 12,
};
/** One character per byte (browsers decode `latin1` as windows-1252, still one per byte); XMP is ASCII. */
const latin1 = new TextDecoder('latin1');

/**
 * AI (Illustrator CS1 and later) is a PDF whose second object is an uncompressed `/Type/Metadata` stream with
 * the XMP packet; the thumbnail is `xmp:Thumbnails` → `xmpGImg:image` (CS1–CS2: `xap:Thumbnails` →
 * `xapGImg:image`), a base64 JPEG. Illustrator writes the `xmpTPg:MaxPageSize` artboard after the thumbnail:
 * until it is read, the scan waits for the end of the packet. AI 7–10 (PostScript) and EPS have no thumbnail.
 */
export function aiThumbnail(head: Uint8Array, size: number): Scan {
  if (size < 5) return null;
  if (head.length < 5) return more(Math.min(size, AI_PACKET_WITHIN), head, size);
  if (ascii(head, 0, 5) !== '%PDF-') return null;
  const text = latin1.decode(head);
  const begin = text.indexOf(PACKET_BEGIN);
  if (begin < 0 || begin >= AI_PACKET_WITHIN) {
    const searched = Math.min(size, AI_PACKET_WITHIN);
    return begin < 0 && head.length < searched ? more(searched, head, size) : null;
  }
  const end = text.indexOf(PACKET_END, begin);
  // Illustrator's packet end comes after history and swatches, hundreds of KB in (in
  // real files the artboard is at 9–15 KB and the packet end at 380–390 KB). Once
  // the thumbnail and the artboard are read whole, the packet end is not needed.
  const packet = end < 0 ? text.slice(begin) : text.slice(begin, end);
  if (end < 0 && !(IMAGE.test(packet) && artboard(packet))) return more(head.length + 1, head, size);
  const match = IMAGE.exec(packet);
  if (!match) return null;
  const raw = (match[2] ?? match[3] ?? '').replace(BREAKS, '');
  if (raw.length > Math.ceil(MAX_JPEG / 3) * 4 || !BASE64.test(raw)) return null;
  let jpeg: Uint8Array;
  try {
    jpeg = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  const thumb = thumbnailSize(jpeg);
  if (!thumb) return null;
  // The original size is the artboard if its proportion matches the thumbnail's; otherwise the image would
  // sit in the tile with a wrong proportion (with several artboards `MaxPageSize` is the largest). The
  // proportion uses exact points before rounding: rounding 101.9 to 102 shifts it by 0.1 %.
  const page = artboard(packet);
  const fits = page !== null && Math.abs(page.ratio / (thumb.width / thumb.height) - 1) <= RATIO_TOLERANCE;
  const { width, height } = fits ? page : thumb;
  return { found: { jpeg, width, height } };
}

const MAX_PAGE = '<xmpTPg:MaxPageSize';
/** Window from the start of `MaxPageSize`: the tag, up to 2,000 characters of fields and the closing tag. */
const MAX_PAGE_WINDOW = 2100;
const MAX_PAGE_ATTRIBUTES = /^<xmpTPg:MaxPageSize\b([^>]{0,2000}?)\/>/;
const MAX_PAGE_ELEMENTS = /^<xmpTPg:MaxPageSize\b([\s\S]{0,2000}?)<\/xmpTPg:MaxPageSize>/;

/**
 * The `xmpTPg:MaxPageSize` artboard, as `stDim` elements or attributes: size in whole points and the exact
 * proportion; missing or garbage gives `null`. The packet is untrusted and parsed synchronously, so time must
 * stay linear: only the first occurrence and a 2100-character window after it are used, and fields avoid
 * adjacent quantifiers over the same characters (16 MB of repeated tags took seconds per call, a field of
 * 1950 spaces made the regex backtrack cubically).
 */
function artboard(packet: string): { width: number; height: number; ratio: number } | null {
  const at = packet.indexOf(MAX_PAGE);
  if (at < 0) return null;
  const window = packet.slice(at, at + MAX_PAGE_WINDOW);
  const block = MAX_PAGE_ATTRIBUTES.exec(window)?.[1] ?? MAX_PAGE_ELEMENTS.exec(window)?.[1];
  if (block === undefined) return null;
  const field = (name: string) => {
    const found = new RegExp(`<stDim:${name}>([^<]*)</stDim:${name}>|stDim:${name}\\s*=\\s*"([^"]*)"`).exec(
      block,
    );
    return (found?.[1] ?? found?.[2] ?? '').trim();
  };
  const value = (name: string) => {
    const text = field(name);
    return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
  };
  const unit = UNIT[field('unit')];
  if (!unit) return null;
  const w = value('w');
  const h = value('h');
  const width = Math.round(w * unit);
  const height = Math.round(h * unit);
  if (!(width >= 1 && height >= 1 && width <= MAX_ARTBOARD && height <= MAX_ARTBOARD)) return null;
  return { width, height, ratio: w / h };
}

/** SOF0…SOF15 frame markers, except DHT (C4), JPG (C8) and DAC (CC). */
const isFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
/** Length segments that may precede SOF and that decoders skip by length: APPn, COM, DQT, DHT, DAC, DRI. */
const isSkipped = (marker: number): boolean =>
  (marker >= 0xe0 && marker <= 0xef) ||
  marker === 0xfe ||
  marker === 0xdb ||
  marker === 0xc4 ||
  marker === 0xcc ||
  marker === 0xdd;

/**
 * JPEG frame size from the SOF marker, before decoding and without trusting surrounding fields: SOI, FF fill
 * bytes, length segments from the allow list, the first SOF. Anything else before SOF gives `null`: markers
 * without length (TEM `FF01`, RST, SOI, EOI), a non-marker (`FF00`), SOS, reserved ones (JPG, JPGn, RES, DNL,
 * DHP, EXP) and a byte other than `FF`. A decoder does not skip such bytes by length, so jumping over them
 * could lead past the real SOF to a decoy (`FFD8 FF01` with a real SOF of 2000 × 1500 and a decoy of 8 × 6
 * made `createImageBitmap` decode 2000 × 1500). Truncation, a length below 2 and a zero height give `null`.
 */
export function jpegSize(jpeg: Uint8Array): { width: number; height: number } | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 <= jpeg.length) {
    if (jpeg[at] !== 0xff) return null;
    const marker = jpeg[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (!isFrame(marker) && !isSkipped(marker)) return null;
    const length = u16(jpeg, at + 2);
    if (length < 2) return null;
    if (isFrame(marker)) {
      if (length < 8 || at + 9 > jpeg.length) return null;
      const height = u16(jpeg, at + 5);
      const width = u16(jpeg, at + 7);
      return width >= 1 && height >= 1 ? { width, height } : null;
    }
    at += 2 + length;
  }
  return null;
}

/** Thumbnail scanner by extension, case-insensitive: PSD, PSB, AI and the AIT template; `null` otherwise. */
export function thumbnailScanner(ext: string): Scanner | null {
  switch (ext.toLowerCase()) {
    case 'psd':
    case 'psb':
      return psdThumbnail;
    case 'ai':
    case 'ait':
      return aiThumbnail;
    default:
      return null;
  }
}
