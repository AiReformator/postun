import { z } from 'zod';

/** Telegram IDs are kept as decimal strings to avoid JS Number precision loss. */
export const TelegramIdSchema = z.string().regex(/^-?[1-9][0-9]{0,19}$/, 'telegram id must be a decimal string');

export const UuidSchema = z.uuid();

export const AccountIdSchema = UuidSchema;

export function isTelegramId(v: unknown): v is string {
  return TelegramIdSchema.safeParse(v).success;
}

export function newId(): string {
  return crypto.randomUUID();
}
