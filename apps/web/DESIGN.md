# Postun design system

Short reference for the site (`postun.org`), the legal pages and the dashboard (`app.postun.org/app/`). Everything lives in
[`public/assets/site.css`](public/assets/site.css) (tokens → base → components → pages) and
[`src/icons.mjs`](src/icons.mjs) (icons and the brand mark). No framework, no external fonts, no CDN.

## Idea

*Connected, not collected.* Warm paper, black ink and one signal colour. The signal (orange) marks the live link between
your Telegram and your AI: the dot in the logo, the moving dot in the hero diagram, link underlines, the quota meter.
Everything else is quiet, so the key promises read first.

## Principles

1. **Mobile first.** Base styles are for a 320–599 px phone; `600`, `768` and `1024` px add columns. No horizontal scroll at
   320 px in any locale.
2. **Promises first, fine print in the documents.** The first screen shows the plain-language tagline, the MCP address to
   copy, the CTA and three checks (not a bot, no API keys, free). The six USPs follow. Caveats and limits live in the beta terms and the data
   handling page, which are linked only from the footer.
3. **Only claim what is verified.** The AI-client list in the hero is derived from `status.json`: `PASS` → "verified",
   anything else → "in testing" (tested in `test/pages.test.mjs`).
4. **CSP-strict.** `style-src 'self'` and `script-src 'self'`: no inline styles, no `style=""`, no inline handlers. Icons are
   inline SVG with presentation-free paths; colours come from CSS. JS is limited to `host.js` (language choice, menu close)
   and the dashboard bundle.
5. **Accessible by default.** WCAG 2.1 AA contrast for every text/background token pair in both themes, visible focus ring,
   skip link, 40–48 px touch targets, `prefers-reduced-motion` stops all animation, `prefers-color-scheme` switches theme.

## Tokens (CSS custom properties)

| Group | Tokens | Notes |
|---|---|---|
| Colour | `--c-bg`, `--c-surface`, `--c-surface-2`, `--c-ink`, `--c-ink-2`, `--c-ink-3`, `--c-line`, `--c-line-strong` | Neutral scale. `ink-3` is the lowest text contrast allowed (≥ 4.7:1 on every surface). |
| | `--c-signal`, `--c-signal-text`, `--c-signal-soft` | `signal` is decorative only (dots, underlines, progress). Use `signal-text` for orange text. |
| | `--c-btn`, `--c-btn-ink`, `--c-btn-hover`, `--c-invert-*`, `--c-band-*` | Primary button and inverted blocks. |
| | `--c-ok`, `--c-warn`, `--c-bad` + `-soft` | Status pills; text on its `-soft` background ≥ 5:1. |
| | `--c-focus` | Focus ring, ≥ 3:1 on the background. |
| Type | `--font-sans`, `--font-mono`; `--text-xs` … `--text-2xl`, `--text-display` | System stacks. Sizes from `lg` up are fluid (`clamp`). |
| | `--leading-*`, `--tracking-*`, `--weight-*` | Display: weight 800, tracking −0.035em. |
| Space | `--s-1` … `--s-16` (4 px base), `--s-section`, `--gutter`, `--container`, `--measure` | Gutter 16 px on phones, 32 px from 768 px. |
| Radius | `--r-sm` 6, `--r-md` 10, `--r-lg` 16, `--r-xl` 24, `--r-pill` | Cards `lg`, feature blocks `xl`, buttons and pills `pill`. |
| Shadow | `--shadow-sm`, `--shadow-md`, `--shadow-lg` | Dark theme uses deeper, black shadows. |
| Motion | `--ease-out`, `--ease-in-out`, `--dur-fast` 120 ms, `--dur-base` 200 ms, `--dur-slow`, `--dur-flow` | Hover lifts and the hero data-flow dot only. |

Dark theme redefines the colour and shadow tokens under `@media (prefers-color-scheme: dark)`; components never hard-code
colours (the QR code keeps a white plate so it always scans).

## Components

| Component | Class | Where |
|---|---|---|
| Header, brand mark, nav, language menu (`<details>`, no JS needed) | `.site-header`, `.brand`, `.site-nav`, `.lang` | all pages |
| Footer with product / open source / legal columns | `.site-footer`, `.foot-grid`, `.foot-col` | all pages |
| Button: primary, secondary, ghost, danger, small | `.btn`, `.btn.secondary`, `.btn-ghost`, `.btn-danger`, `.btn-sm` | |
| Badge (Beta) | `.badge` | header, page titles |
| Status pill | `.pill` + `.pill-ok` / `.pill-warn` / `.pill-bad`; status table keeps `.st-*` | hero, status table, dashboard |
| MCP address with copy button (button hidden until `host.js` confirms the Clipboard API; on failure the address is selected) | `.endpoint`, `.endpoint-field`, `.endpoint-copy` | hero |
| Check chips | `.chips` | hero |
| Eyebrow | `.eyebrow` | hero |
| Card | `.card`, `.card-head`, `.card-title` | dashboard |
| Section heading | `.section`, `.section-head` | landing |
| Flow diagram (Telegram → Postun → AI clients) | `.flow`, `.flow-node`, `.flow-core`, `.flow-link`, `.flow-clients` | hero |
| USP grid | `.usp-grid`, `.usp`, `.usp-lead`, `.usp-figure` | landing |
| Numbered steps | `.steps` | landing |
| Table | `.table-wrap` + `table.status` | status, data handling |
| FAQ accordion | `.faq details` | landing |
| Inverted band, final CTA | `.band`, `.final` | landing |
| Document | `.doc`, `.doc ul.terms`, `.translation` | privacy, terms |
| Notice, meter, rows, tags, copy field, QR, form field | `.notice`, `progress.meter`, `.rows`, `.tags`, `.copy-field`, `.qr`, `.field` | dashboard |
| Icon (24 px, 1.75 stroke) | `icon(name)` in `src/icons.mjs` | everywhere |

## Adding things

- New colour: add a token to both themes and check contrast against every surface it can sit on.
- New text: add the key to **all five** locales (`ru.mjs` is the key source, English is the published default);
  `checkLocales` fails the build otherwise. Legal texts change only with the owner's approval.
- New page: render it through `layout()` in `src/pages.mjs` so it gets the header, footer, `lang`, canonical and hreflang.
- Before a PR: `npm run ci` from the repository root, then look at 375, 768 and 1280 px in both themes.
