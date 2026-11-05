// Postun icon set: 24×24, 1.75 stroke, round caps. Constant markup only (shared by the static pages and the cabinet bundle).
export const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18h2"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  code: '<path d="M8.5 6.5L3 12l5.5 5.5M15.5 6.5L21 12l-5.5 5.5"/>',
  gift: '<path d="M20 12v9H4v-9M2.5 7.5h19V12h-19zM12 21V7.5"/><path d="M12 7.5H8a2.5 2.5 0 1 1 0-5c3 0 4 5 4 5zM12 7.5h4a2.5 2.5 0 1 0 0-5c-3 0-4 5-4 5z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'
};

/** Decorative inline SVG icon (aria-hidden). Unknown names throw so a typo fails the build. */
export function icon(name, cls = 'icon') {
  const paths = ICONS[name];
  if (!paths) throw new Error(`unknown icon ${name}`);
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/** The Postun mark: an open "P" whose bowl ends in a signal dot — a connection, not a container. Colors come from CSS. */
export const BRAND_MARK =
  '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect class="bm-bg" width="32" height="32" rx="9"/><path class="bm-p" d="M11.5 24V8.5h5.25a4.75 4.75 0 0 1 0 9.5H15"/><circle class="bm-dot" cx="22.5" cy="23" r="2.25"/></svg>';
