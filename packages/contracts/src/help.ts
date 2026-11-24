/**
 * Self-service help and problem reports (docs/03 section 4, "Problem reports").
 *
 * Two MCP tools sit on top of this: `get_help` (static guidance an AI client relays to its user) and `report_problem`
 * (the user, after confirming the text, sends a short structured report that the operator reviews). Neither touches
 * Telegram. Everything stored is a closed vocabulary plus one short free-text field that is scrubbed before it is kept.
 */
import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './errors';
import { TOOLS } from './scopes';

/**
 * Help topics. The same ids are the anchors of the public help page (postun.org/help/#<id>), so the AI client and the
 * website give the user the same answer. A test keeps this list, the MCP guidance and the site in step.
 */
export const HELP_TOPIC_IDS = [
  'session-ended',
  'no-reconnect-button',
  'qr-not-scanning',
  'other-account',
  'missing-dialogs',
  'archived-chats',
  'why-ended',
  'paused',
  'quota',
  'channels-ok-dialogs-fail',
  'read-only',
  'still-stuck'
] as const;
export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number];

export const REPORT_CATEGORIES = [
  'session_problem',
  'reconnect_failed',
  'missing_data',
  'wrong_data',
  'error_not_in_help',
  'slow_or_limits',
  'connector_setup',
  'other'
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** How a report is handled; the numbers are promised to users, so they live in one place. */
export const REPORT_SUMMARY_MIN = 10;
export const REPORT_SUMMARY_MAX = 500;
/** Reports one owner may send per UTC day (a ticket flood protection, not a quality limit). */
export const REPORTS_PER_DAY = 5;
export const REPORT_RETENTION_DAYS = 90;
/** The operator reads new reports at least once a day and aims to answer or publish guidance within this many hours. */
export const REPORT_REVIEW_HOURS = 48;
/** Stop accepting new reports when this many are still unreviewed (a storage guard, never reached in normal use). */
export const REPORT_BACKLOG_LIMIT = 5000;

const UUID = z.uuid();
const errorCodes = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

/** What the MCP worker sends to the admin store. `principalRef` is the same opaque id the admin projection uses. */
export const ProblemReportSchema = z.strictObject({
  principalRef: z.string().min(16).max(64),
  category: z.enum(REPORT_CATEGORIES),
  tool: z.enum(TOOLS).nullable(),
  errorCode: z.enum(errorCodes).nullable(),
  errorReason: z.string().regex(/^[A-Z][A-Z_]{1,39}$/).nullable(),
  accountRef: UUID.nullable(),
  client: z.string().regex(/^[A-Za-z0-9 ._+-]{1,40}$/).nullable(),
  summary: z.string().min(REPORT_SUMMARY_MIN).max(REPORT_SUMMARY_MAX)
});
export type ProblemReport = z.infer<typeof ProblemReportSchema>;

/** Result of storing a report: the ticket id the user can quote. */
export interface ProblemReportReceipt {
  ticket: string;
  receivedAt: string;
}

/** Replaces control and invisible/bidi characters with a space (written with code points, not escapes in a regex). */
function stripInvisible(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const bad = c < 0x20 || c === 0x7f || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
    out += bad ? ' ' : ch;
  }
  return out;
}

/**
 * Last line of defence for the one free-text field. The tool tells the AI not to put message content, names or numbers
 * into it, and the user confirms the text; this strips what slips through anyway: links, @handles, phone-like and other
 * digit runs of five or more (ISO dates are kept), control and invisible characters. It never adds information.
 */
export function scrubReportText(raw: string): string {
  return stripInvisible(raw)
    .replace(/(?:https?:\/\/|www\.|t\.me\/)\S+/gi, '[link]')
    .replace(/@[A-Za-z0-9_]{3,}/g, '@[name]')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, (m) => (/^\d{4}-\d{2}-\d{2}$/.test(m) || m.replace(/\D/g, '').length < 7 ? m : '[number]'))
    .replace(/\d{5,}/g, '[number]') // login codes, ids and other long numbers
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, REPORT_SUMMARY_MAX);
}
