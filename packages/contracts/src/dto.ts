import { z } from 'zod';
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

export const AccountStatusSchema = z.enum(['pending', 'active', 'revocation_pending', 'disconnected']);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export interface LinkedAccountView {
  accountId: string;
  status: AccountStatus;
  label: string; // user-chosen or masked label; never the phone number
  createdAt: string;
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
