import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PASSWORD_FACTS, PASSWORD_FLOW_STEPS, SOURCE_URL } from '../src/password-flow.mjs';
import { ICONS } from '../src/icons.mjs';
import { LOCALES } from '../i18n/index.mjs';

describe('2FA password explainer', () => {
  it('every locale has the texts of every stage and fact', () => {
    for (const l of LOCALES) {
      const app = l.dict.app;
      for (const k of ['pwInfoTitle', 'pwFlowLabel', 'pwChipProof', 'pwChipGone', 'pwSource', 'pwSourceLink']) expect(app[k], `${l.code} ${k}`).toBeTruthy();
      for (const s of PASSWORD_FLOW_STEPS) {
        expect(app[`${s.key}Title`], `${l.code} ${s.key}`).toBeTruthy();
        expect(app[`${s.key}Text`], `${l.code} ${s.key}`).toBeTruthy();
      }
      for (let i = 1; i <= PASSWORD_FACTS; i++) expect(app[`pwFact${i}`], `${l.code} pwFact${i}`).toBeTruthy();
    }
  });

  it('shows the stages in order: password, encrypted channel, SRP proof, discarded', () => {
    expect(PASSWORD_FLOW_STEPS.map((s) => s.chip)).toEqual(['password', 'password', 'proof', 'gone']);
    for (const s of PASSWORD_FLOW_STEPS) expect(ICONS[s.icon], s.icon).toBeTruthy();
  });

  it('links to the code that handles the password, and that file exists', () => {
    const rel = SOURCE_URL.replace('https://github.com/AiReformator/postun/blob/main/', '');
    expect(existsSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)))).toBe(true);
    expect(readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8')).toContain('submitPassword');
  });

  it('the animation is CSS only and stops when the user prefers reduced motion', () => {
    const css = readFileSync(fileURLToPath(new URL('../public/assets/site.css', import.meta.url)), 'utf8');
    for (let k = 1; k <= 4; k++) expect(css).toContain(`@keyframes pw-node-${k}`);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.pw-step .pw-node');
    expect(reduced).toContain('animation: none !important');
  });
});
