// File size as Windows Explorer's file Properties writes it (`StrFormatByteSizeW`): 75,332 bytes is "73.5
// KB", 2,414,012 is "2.30 MB". No `obsidian` import, so `node --test` checks it as is.
import { t } from '../i18n/dict/inspector.ts';

/**
 * Unit keys of the panel dictionary: KB, MB, GB, TB, PB in the Buba language ("KB" in English, as Explorer).
 */
const UNITS = ['sizeKB', 'sizeMB', 'sizeGB', 'sizeTB', 'sizePB'] as const;

/**
 * Under 1024 bytes: "N bytes". Otherwise the unit is the first of KB, MB, GB, TB, PB where the number is
 * below 1000 (1,023,999 is "999 KB", 1,024,000 is "0.97 MB"); two decimals below 10, one below 100, none
 * otherwise. Extra digits are truncated, not rounded, trailing zeros stay ("1.00 KB"), and the remainder of
 * the previous unit is dropped at every step (2,474,996 is "2.35 MB", not "2.36"). Integer math: reliable on
 * any device, and division by 1024 is exact. The decimal separator and digits follow the Obsidian language,
 * as Obsidian's own numbers do (`Intl.NumberFormat`; `language` is a tag from src/platform/locale.ts, default
 * `Intl` language if absent): "73.5" in English, "73,5" in Russian. Explorer takes the separator from Windows
 * regional settings, which have no public API. Units and "bytes" follow the Buba language (file panel
 * dictionary); bytes have no thousands separator.
 */
export function formatSize(bytes: number, language: string | undefined): string {
  if (bytes < 1024) {
    const size = new Intl.NumberFormat(language, { useGrouping: false }).format(bytes);
    return t('sizeBytes', { count: bytes, size });
  }
  let whole = bytes;
  let unit = 0;
  while (whole >= 1000 * 1024 && unit < UNITS.length - 1) {
    whole = Math.floor(whole / 1024);
    unit += 1;
  }
  const digits = whole < 10 * 1024 ? 2 : whole < 100 * 1024 ? 1 : 0;
  const scale = 10 ** digits;
  const number = new Intl.NumberFormat(language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return t(UNITS[unit] ?? 'sizePB', { size: number.format(Math.floor((whole * scale) / 1024) / scale) });
}
