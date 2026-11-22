/**
 * `get_help`: Postun's own troubleshooting guide, written for an AI client to relay to its user. Static text; nothing
 * here comes from Telegram or from the user. The topic ids are the anchors of the public help page
 * (https://postun.org/help/#<id>); a test keeps both in step.
 *
 * The user-facing steps are what the USER does (open the dashboard, scan a QR code in Telegram); the AI client cannot
 * do them for the user and must say so plainly instead of retrying.
 */
import { HELP_TOPIC_IDS, REPORT_REVIEW_HOURS, REPORTS_PER_DAY, type HelpTopicId } from '@postun/contracts';

export interface HelpTopic {
  title: string;
  /** What the AI client or the user sees when this applies. */
  when: string[];
  cause: string;
  /** What to do, in order. */
  steps: string[];
}

export const HELP_SITE = 'https://postun.org/help/';
const DASHBOARD = 'https://app.postun.org';

export const HELP: Readonly<Record<HelpTopicId, HelpTopic>> = {
  'session-ended': {
    title: 'The Telegram session ended: chats cannot be read until the account is reconnected',
    when: [
      'A tool returns ACCOUNT_NOT_ACTIVE with reason SESSION_ENDED',
      'list_accounts shows status "ended" (or "active" while reads still fail)',
      'The dashboard shows "session ended"'
    ],
    cause:
      'Telegram closed the session Postun uses for this account. The account keeps its id and every AI client\'s access; only a new Telegram sign-in is missing. It is the user who has to do it: an AI client cannot reconnect an account.',
    steps: [
      `Ask the user to open the Postun dashboard (${DASHBOARD}) and sign in.`,
      'Next to the account press "Reconnect". Do not press "Disconnect": that removes the account and its access.',
      'Scan the QR code inside Telegram on the phone (Settings > Devices > Link Desktop Device), signed in to the SAME Telegram account as before; enter the cloud password if Telegram asks.',
      'After that call list_accounts and repeat the read. No new OAuth consent is needed.'
    ]
  },
  'no-reconnect-button': {
    title: 'The account looks active but cannot be read, and there is no Reconnect button',
    when: ['The dashboard shows the account as active, but reads fail with ACCOUNT_NOT_ACTIVE', 'The dashboard offers only "Disconnect" and "Connect an account via QR"'],
    cause:
      'The dashboard offers Reconnect only after Postun has noticed that Telegram ended the session. Postun notices when a read fails and at its own periodic check (about every 6 hours), so the status can lag behind.',
    steps: [
      'Repeat any read (for example list_dialogs for that account): a failed read marks the session as ended right away.',
      'Ask the user to reload the dashboard. The status becomes "session ended" with the reason, and the Reconnect button appears. Then follow the "session-ended" steps.',
      'If the account still shows active and reads keep failing, do not press Disconnect. Offer to send a problem report (see "still-stuck").'
    ]
  },
  'qr-not-scanning': {
    title: 'The QR code does not scan, or Telegram does not accept it',
    when: ['The phone does not recognise the QR code in the dashboard', 'Telegram says the code is invalid or expired'],
    cause: 'The QR code is a Telegram sign-in code. It works only when scanned inside Telegram, only with the right account, and it changes about every 30 seconds.',
    steps: [
      'Scan it inside Telegram: Settings > Devices > Link Desktop Device. A phone camera app or another scanner often does not work.',
      'Make sure the phone is signed in to the same Telegram account that is connected to Postun (its label is shown in the dashboard). Scanning with another account is the most common reason.',
      'The code refreshes by itself every ~30 seconds, so scan the current one. Zoom the page to 150-200% and hold the phone 20-30 cm from a bright screen.',
      'If Telegram asks for the cloud password (two-step verification), enter it in the dashboard when it asks.',
      'Still failing: reload the page and press Reconnect (or Connect) again to get a fresh code.'
    ]
  },
  'other-account': {
    title: 'Reconnect says the QR code was scanned by a different Telegram account',
    when: ['Reconnect ends with a message that another Telegram account scanned the code (NOT_ALLOWED)'],
    cause: 'A reconnect can restore only the same Telegram user, so that an access grant can never move to someone else\'s chats.',
    steps: [
      'In Telegram on the phone switch to the account that was originally connected (compare with the account label in the dashboard).',
      'Press Reconnect again and scan the new QR code with that account.',
      'To use a different Telegram account, connect it separately with "Connect an account via QR".'
    ]
  },
  'missing-dialogs': {
    title: 'Only some chats are listed, or a chat or bot is missing',
    when: ['list_dialogs returns fewer chats than the user has', 'A chat or a bot the user is sure exists is not in the list'],
    cause:
      'list_dialogs is paged and shows only the chats of the connected Telegram account. Postun is read-only: it cannot start a chat or press Start in a bot.',
    steps: [
      'Continue with nextCursor until it is null (limit up to 100 per page); do not stop at the first page.',
      'Check that the chat or bot exists in the same Telegram account that is connected to Postun (compare the account label). A bot started from another account does not appear.',
      'A chat that was never started, or that is archived in Telegram, may be missing: ask the user to open it in Telegram (send /start to a bot themselves), then list again.',
      'To find something in a known chat use search_messages with its peer; global search is slower and limited.'
    ]
  },
  'why-ended': {
    title: 'Why did the Telegram session end?',
    when: ['The user asks what happened to the connection', 'The dashboard shows a reason next to "session ended"'],
    cause: 'Telegram tells Postun why it ended a session, and Postun keeps that reason (and the time) in a technical journal. The dashboard shows it next to the account.',
    steps: [
      'Closed under Settings > Devices in Telegram, or "Terminate all other sessions": reconnect the account.',
      'Telegram invalidated the session key: reconnect. If it keeps repeating, report it (see "still-stuck").',
      'The Telegram account was deleted or deactivated: reconnecting helps only once the account works again.',
      'The session expired: reconnect.',
      'The same session key was used from two places at once (a Postun-side problem): Postun records it and checks the session again; if the account keeps ending, report it.'
    ]
  },
  paused: {
    title: 'A call is "paused" or rate limited',
    when: ['A result has status "paused", code RATE_LIMITED, or CONFLICT with reason ACCOUNT_BUSY'],
    cause: 'Telegram asked the account to slow down (FLOOD_WAIT) or Postun is spacing calls out. Nothing was refused and nothing is limited in what can be found.',
    steps: [
      'Wait retryAfterSeconds, then repeat exactly the same call with the same arguments or cursor.',
      'Make calls for one account one after another, not in parallel.',
      'Do not tell the user the search was limited. If the wait is long, say until when the search is on hold.'
    ]
  },
  quota: {
    title: 'The free beta quota is used up',
    when: ['A tool returns QUOTA_EXCEEDED'],
    cause: 'The free beta allows a fixed number of successful operations per UTC day per owner (10,000 by default). The day resets at 00:00 UTC.',
    steps: [
      'Wait until the next UTC day.',
      'Read in full pages (limit up to 100) and prefer search inside a chat (peer): fewer calls for the same result.',
      'list_accounts, get_help, report_problem and failed calls do not count.'
    ]
  },
  'channels-ok-dialogs-fail': {
    title: 'Public channels can be read but chats cannot, or the other way round',
    when: ['get_channel_posts works while list_dialogs or get_history fails', 'Some reads succeed and others fail for the same account'],
    cause: 'Every read uses the same Telegram session, so if one read succeeds the session is alive. The cause is then something else: the wrong account, a chat that is not in this account, paging, or a Telegram wait.',
    steps: [
      'Compare the account label in list_accounts with the Telegram account the user means.',
      'Follow "missing-dialogs" for a chat or bot that is not listed.',
      'If a read still fails with an error that no topic explains, offer to send a problem report (see "still-stuck").'
    ]
  },
  'read-only': {
    title: 'The user asks the AI to write, reply, press Start or delete in Telegram',
    when: ['The user wants a message sent, a bot started, a message edited or deleted'],
    cause: 'Postun is read-only by design: no tool can write to Telegram.',
    steps: ['Tell the user to do it in Telegram themselves (for a bot: open it and press Start).', 'Then read the result with list_dialogs, get_history or search_messages.']
  },
  'still-stuck': {
    title: 'Nothing here solves it: how to report a problem',
    when: ['An error is not described by any topic', 'The steps were followed and the problem remains'],
    cause: 'Some problems need a person at Postun. The user can send a short report straight from this chat.',
    steps: [
      'Say briefly what was tried (the topics above) and what happened, including any error code.',
      'Offer to send a problem report. Show the user the exact category and summary and wait for a clear yes. Never include message text, chat or person names, phone numbers, login codes or links.',
      'On a yes call report_problem with user_confirmed true, then give the user the ticket id.',
      `Reports are read at least once a day and Postun aims to answer or publish guidance within ${REPORT_REVIEW_HOURS} hours. Postun cannot contact the user directly, so point them to ${HELP_SITE} or have the AI call get_help again later.`,
      'Other channels: https://github.com/AiReformator/postun/issues (public: no private data there) or Telegram @postun_org.'
    ]
  }
};

const SUPPORT = {
  report_tool: 'report_problem',
  review: `New reports are read at least once a day; Postun aims to answer or publish guidance within ${REPORT_REVIEW_HOURS} hours (beta, no guarantee).`,
  limit: `At most ${REPORTS_PER_DAY} reports per day per owner. The user must have seen and agreed to the exact text.`,
  site: HELP_SITE
} as const;

/** The result of `get_help`: one topic, or the list of topics when none is asked for. */
export function getHelp(topic: HelpTopicId | undefined): Record<string, unknown> {
  if (topic === undefined) {
    return {
      topics: HELP_TOPIC_IDS.map((id) => ({ id, title: HELP[id].title })),
      how_to_use: 'Call get_help again with one topic id. Relay the steps to the user in their language; the user does them, not you.',
      support: SUPPORT
    };
  }
  const t = HELP[topic];
  return { topic, title: t.title, when: t.when, cause: t.cause, steps: t.steps, more: `${HELP_SITE}#${topic}`, support: SUPPORT };
}

/**
 * A fixed pointer into the guide for an error code (and reason), so every refusal tells the AI where the user's next
 * step is described. `undefined` when no topic fits.
 */
export function helpTopicFor(code: string, reason: string | undefined): HelpTopicId | undefined {
  if (reason === 'SESSION_ENDED') return 'session-ended';
  if (code === 'ACCOUNT_NOT_ACTIVE') return 'no-reconnect-button';
  if (code === 'RATE_LIMITED' || reason === 'ACCOUNT_BUSY') return 'paused';
  if (code === 'QUOTA_EXCEEDED') return 'quota';
  if (code === 'NOT_FOUND') return 'missing-dialogs';
  if (code === 'INTERNAL' || code === 'UPSTREAM_UNAVAILABLE') return 'still-stuck';
  return undefined;
}
