import { z } from 'zod';
import type { SessionErrorCode } from './errors';
import { SCOPES } from './scopes';

export const GrantPropsSchema = z.object({
  principalId: z.uuid(),
  grantId: z.uuid(),
  accounts: z.array(z.uuid()).max(10),
  scopes: z.array(z.enum(SCOPES)),
  grantVersion: z.number().int().nonnegative()
});
/** Props stored by the OAuth library with each grant: opaque references only, never MTProto sessions. */
export type GrantProps = z.infer<typeof GrantPropsSchema>;

/** 'ended': Telegram ended the session; the account keeps its id and grants and can be reconnected with a new QR login. */
export const AccountStatusSchema = z.enum(['pending', 'active', 'ended', 'revocation_pending', 'disconnected']);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export interface LinkedAccountView {
  accountId: string;
  status: AccountStatus;
  label: string; // user-chosen or masked label; never the phone number
  createdAt: string;
  /** Only for status 'ended': when Telegram ended the session and, if known, the closed-vocabulary reason. */
  endedAt?: string;
  endedCode?: SessionErrorCode;
}

/**
 * Connection journal (docs/03 section 4). Technical events about one account's Telegram session, from a closed
 * vocabulary. Never message text, peers, search queries, file names, Telegram free text or identifiers of other people.
 */
export const SESSION_EVENT_KINDS = ['linked', 'session_ended', 'key_duplicate', 'relinked', 'relink_refused'] as const;
export type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];

/** What triggered the event: an AI tool call (by tool name), the periodic health check, or the link flow. */
export type SessionEventSource = 'health_check' | 'link' | 'relink' | (string & {});

export interface AccountEventView {
  at: string; // ISO time
  event: SessionEventKind;
  code: SessionErrorCode | null;
  /** Tool name, 'health_check', 'link' or 'relink'. */
  source: SessionEventSource | null;
}

export interface UsageView {
  month: string;
  successCount: number;
  outBytes: number;
  monthlySuccessLimit: number;
  /** UTC day and its successful operations; dailySuccessLimit null = no daily limit. */
  day: string;
  daySuccessCount: number;
  dailySuccessLimit: number | null;
}

/** Fixed-schema aggregate projection sent to the Admin Worker (docs/02 §2). */
export const AdminProjectionSchema = z.object({
  principalRef: z.string().min(16).max(64), // HMAC/opaque, never a raw Telegram id
  revision: z.number().int().nonnegative(),
  linkedAccounts: z.number().int().min(0).max(100),
  status: z.enum(['active', 'suspended', 'deleted']),
  plan: z.literal('beta_free'),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  successCount: z.number().int().nonnegative(),
  outBytes: z.number().int().nonnegative()
});
export type AdminProjection = z.infer<typeof AdminProjectionSchema>;
