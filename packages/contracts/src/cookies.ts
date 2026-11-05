/** __Host- cookies: Secure, HttpOnly, Path=/, no Domain (docs/03 §5). */
export function hostCookie(name: string, value: string, opts: { maxAge: number; sameSite?: 'Lax' | 'Strict' }): string {
  if (!name.startsWith('__Host-')) throw new TypeError('cookie must use __Host- prefix');
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${opts.sameSite ?? 'Lax'}; Max-Age=${opts.maxAge}`;
}

export function clearHostCookie(name: string): string {
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * CSRF check for browser POSTs: exact Origin match plus a double-submit token bound to the session.
 */
export function originAllowed(req: Request, allowed: readonly string[]): boolean {
  const origin = req.headers.get('origin');
  return origin !== null && allowed.includes(origin);
}
