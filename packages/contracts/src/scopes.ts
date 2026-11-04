/** OAuth scopes granted to AI clients. Read-only by construction: no write scope exists. */
export const SCOPES = ['accounts:read', 'dialogs:read', 'messages:read', 'channels:read', 'media:read'] as const;
export type Scope = (typeof SCOPES)[number];

export const TOOLS = [
  'list_accounts',
  'list_dialogs',
  'get_history',
  'search_messages',
  'search_channels',
  'get_channel_posts',
  'get_media_info',
  'get_media'
] as const;
export type ToolName = (typeof TOOLS)[number];

/** Scope required by each tool. The server enforces this regardless of MCP hints. */
export const TOOL_SCOPE: Readonly<Record<ToolName, Scope>> = {
  list_accounts: 'accounts:read',
  list_dialogs: 'dialogs:read',
  get_history: 'messages:read',
  search_messages: 'messages:read',
  search_channels: 'channels:read',
  get_channel_posts: 'channels:read',
  get_media_info: 'media:read',
  get_media: 'media:read'
};

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/** Keeps only known scopes, de-duplicated, in canonical order. Unknown scopes are dropped, never widened. */
export function normalizeScopes(input: readonly string[]): Scope[] {
  const wanted = new Set(input);
  return SCOPES.filter((s) => wanted.has(s));
}

export function hasScope(granted: readonly string[], tool: ToolName): boolean {
  return granted.includes(TOOL_SCOPE[tool]);
}
