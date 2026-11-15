// "How Postun handles your cloud password", shown next to the 2FA password field of the cabinet.
// Every statement here must stay true for the code: the password travels over HTTPS to postun-auth, goes to the
// principal's Durable Object over the private service binding, is handed to the Telegram library in memory, which
// sends Telegram only an SRP proof (the password itself never leaves Postun), and is never stored or logged
// (apps/mcp/src/do/session-do.ts submitPassword, apps/mcp/src/telegram/mtcute.ts, scripts/check-no-logging.mjs).
// The animation is CSS only (CSP style-src 'self') and stops under prefers-reduced-motion.

/**
 * The four stages. `chip` is what travels at that stage: the password (masked), the SRP proof that replaces it, or the
 * discarded password. The CSS animates them in order: the password moves, turns into the proof, and is crossed out.
 */
export const PASSWORD_FLOW_STEPS = [
  { key: 'pwStep1', icon: 'phone', chip: 'password' },
  { key: 'pwStep2', icon: 'lock', chip: 'password' },
  { key: 'pwStep3', icon: 'link', chip: 'proof' },
  { key: 'pwStep4', icon: 'check', chip: 'gone' }
];
export const PASSWORD_FACTS = 5;
export const SOURCE_URL = 'https://github.com/AiReformator/postun/blob/main/apps/mcp/src/do/session-do.ts';
const MASK = '•••••••';

function chip(kind, el, T) {
  if (kind === 'proof') {
    return el('span', { class: 'pw-chip pw-chip-proof' },
      el('span', { class: 'pw-chip-from' }, MASK),
      el('span', { class: 'pw-chip-arrow', 'aria-hidden': 'true' }, '→'),
      el('span', { class: 'pw-chip-to' }, T('pwChipProof'))
    );
  }
  if (kind === 'gone') return el('span', { class: 'pw-chip pw-chip-gone' }, el('span', { class: 'pw-chip-from' }, MASK), ' ', T('pwChipGone'));
  return el('span', { class: 'pw-chip' }, MASK);
}

/** Builds the explainer with the cabinet's own DOM helpers; all text goes through textContent. */
export function passwordFlow({ el, icon, T }) {
  const steps = PASSWORD_FLOW_STEPS.map((s, i) =>
    el('li', { class: `pw-step pw-step-${i + 1}` },
      el('span', { class: 'pw-node', 'aria-hidden': 'true' }, icon(s.icon)),
      el('span', { class: 'pw-text' }, el('strong', {}, T(`${s.key}Title`)), el('span', {}, T(`${s.key}Text`)), chip(s.chip, el, T))
    )
  );
  const facts = Array.from({ length: PASSWORD_FACTS }, (_, i) => el('li', {}, T(`pwFact${i + 1}`)));
  return el('details', { class: 'pw-info', open: '' },
    el('summary', {}, icon('lock'), T('pwInfoTitle')),
    el('figure', { class: 'pw-flow' },
      el('figcaption', { class: 'visually-hidden' }, T('pwFlowLabel')),
      el('ol', { class: 'pw-steps' }, ...steps)
    ),
    el('ul', { class: 'pw-facts' }, ...facts),
    el('p', { class: 'note' }, T('pwSource'), ' ', el('a', { href: SOURCE_URL, rel: 'noopener' }, T('pwSourceLink')))
  );
}
