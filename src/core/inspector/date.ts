// Buba date and time follow the "Date format" and "Time format" settings (Settings → Buba → Language and
// region), not the Obsidian language. No `obsidian` import, so `node --test` checks it as is.
import { t } from '../i18n/dict/inspector.ts';

/** "Date format": `dmy` is day, month, year (21 Oct 2026), `mdy` is month, day, year (Oct 21, 2026). */
export const DATE_FORMATS = ['dmy', 'mdy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
/** "Time format": `24h` is 24-hour (23:31), `12h` is 12-hour (11:31 PM). */
export const TIME_FORMATS = ['24h', '12h'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export interface DateLook {
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
}

/** Defaults: day first and 24-hour time. */
export const DEFAULT_DATE_LOOK: Readonly<DateLook> = Object.freeze({ dateFormat: 'dmy', timeFormat: '24h' });

/** Digits of any script (`\p{Nd}`): a month written as a number, not a word (ja, zh, cs, fi). */
const NUMERIC = /^\p{Nd}+$/u;

/**
 * Date and time: "21 Oct 2026, 23:31", "Oct 21, 2026, 11:31 PM". Day/month order and 12 or 24 hours come only
 * from `look`; the language (`language` is a tag from src/platform/locale.ts, default `Intl` language if
 * absent) gives the month name and digits, as Obsidian does for its own numbers. A language with numeric
 * months gives "21.10.2026" and "10/21/2026". AM/PM is Latin in any language. The calendar is always
 * Gregorian, as Obsidian dates (`moment`): otherwise `Intl` writes the Persian solar year or the Thai
 * Buddhist one. The time zone is the device's unless given.
 */
export function formatDateTime(
  ms: number,
  language: string | undefined,
  look: Readonly<DateLook> = DEFAULT_DATE_LOOK,
  timeZone?: string,
): string {
  const { day = '', month = '', year = '' } = parts(dateFormat(language, timeZone), ms);
  const date = datePart(look.dateFormat, day, month, year);
  const twelve = look.timeFormat === '12h';
  const time = parts(
    new Intl.DateTimeFormat(language, {
      hour: twelve ? 'numeric' : '2-digit',
      minute: '2-digit',
      hourCycle: twelve ? 'h12' : 'h23',
      timeZone,
    }),
    ms,
  );
  const clock = `${time.hour ?? ''}:${time.minute ?? ''}`;
  if (!twelve) return `${date}, ${clock}`;
  // Noon and later is PM: the hour of day in the time zone, in Latin digits.
  const hour = Number(
    parts(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone }), ms).hour,
  );
  return `${date}, ${clock} ${hour < 12 ? 'AM' : 'PM'}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Short time, as in Notion and GitHub: "now" under a minute (and slightly ahead of `now`:
 * another device's clock), then minutes ("5m") under an hour, hours under a day, days
 * under 7 days (elapsed time, rounded down), then day and month without time ("6 Oct",
 * "Oct 6"), with the year only if it is not the current calendar year in the time zone
 * ("6 Oct 2025"). Day/month order is `look.dateFormat`; words follow the Buba language.
 */
export function formatRelative(
  ms: number,
  now: number,
  language: string | undefined,
  look: Readonly<DateLook> = DEFAULT_DATE_LOOK,
  timeZone?: string,
): string {
  const ago = now - ms;
  if (ago < MINUTE) return t('agoNow');
  if (ago < HOUR) return t('agoMinutes', { count: Math.floor(ago / MINUTE) });
  if (ago < DAY) return t('agoHours', { count: Math.floor(ago / HOUR) });
  if (ago < WEEK) return t('agoDays', { count: Math.floor(ago / DAY) });
  const { day = '', month = '', year = '' } = parts(dateFormat(language, timeZone), ms);
  return datePart(look.dateFormat, day, month, yearOf(ms, timeZone) === yearOf(now, timeZone) ? null : year);
}

/** Year by the time zone's calendar. */
function yearOf(ms: number, timeZone: string | undefined): string | undefined {
  return parts(new Intl.DateTimeFormat('en', { year: 'numeric', calendar: 'gregory', timeZone }), ms).year;
}

function parts(
  format: Intl.DateTimeFormat,
  ms: number,
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of format.formatToParts(ms)) out[part.type] = part.value;
  return out;
}

/** Day, month and year format of the language: short month word, Gregorian calendar. */
function dateFormat(language: string | undefined, timeZone: string | undefined): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    calendar: 'gregory',
    timeZone,
  });
}

/**
 * Day, month and year (`year` is `null` to omit it) in the "Date format" order: "21 Oct 2026", "Oct 21,
 * 2026"; with numeric months "21.10.2026", "10/21/2026".
 */
function datePart(order: DateFormat, day: string, month: string, year: string | null): string {
  const numeric = NUMERIC.test(month);
  if (order === 'mdy') {
    const md = numeric ? `${month}/${day}` : `${month} ${day}`;
    return year === null ? md : numeric ? `${md}/${year}` : `${md}, ${year}`;
  }
  const dm = numeric ? `${day}.${month}` : `${day} ${month}`;
  return year === null ? dm : numeric ? `${dm}.${year}` : `${dm} ${year}`;
}
