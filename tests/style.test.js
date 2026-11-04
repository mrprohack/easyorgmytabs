// style.test.js - design tokens and the contrast guard (CSS lint is added with the popup and dashboard styling).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

// First `:root { ... }` block as { '--name': 'value' }.
function parseRootTokens(css) {
  const block = /:root\s*\{([^}]*)\}/.exec(css);
  const tokens = {};
  if (!block) return tokens;
  for (const [, name, value] of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

// WCAG 2.x relative luminance and contrast ratio for 6-digit hex colours.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fgHex, bgHex) {
  const [hi, lo] = [luminance(fgHex), luminance(bgHex)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// Removes every `@media (prefers-reduced-motion: reduce) { ... }` block (brace matched).
function stripReducedMotion(css) {
  const marker = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  let out = '';
  let last = 0;
  let match;
  while ((match = marker.exec(css))) {
    let depth = 1;
    let i = marker.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out += css.slice(last, match.index);
    last = i;
    marker.lastIndex = i;
  }
  return out + css.slice(last);
}

// Rules every stylesheet must follow: 11px type floor, no !important (except reduced-motion), no #94a3b8 text.
function lintCss(fileName) {
  const css = read(fileName).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, value] of css.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
    for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) {
      assert.ok(parseFloat(px) >= 11, `${fileName}: font-size "${value.trim()}" contains ${px}px, below the 11px floor`);
    }
  }
  assert.ok(!/!important/.test(stripReducedMotion(css)), `${fileName}: !important is only allowed inside @media (prefers-reduced-motion: reduce)`);
  assert.ok(!/(^|[;{\s])color\s*:\s*#94a3b8/i.test(css), `${fileName}: #94a3b8 must not be used as a text colour`);
}

const REQUIRED = ['--fs-chip', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl', '--fs-display', '--text', '--text-2', '--text-muted',
  '--accent', '--accent-strong', '--accent-soft', '--on-accent', '--surface', '--surface-glass', '--border', '--page-light', '--page-dark',
  '--success', '--success-soft', '--danger', '--danger-soft', '--warn', '--warn-soft', '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5',
  '--r-sm', '--r-md', '--r-lg', '--r-xl', '--target-popup', '--target-dash', '--focus-ring'];

const PAIRS = [['--text', '--surface'], ['--text-2', '--surface'], ['--text-muted', '--surface'], ['--text-muted', '--page-light'],
  ['--text-muted', '--page-dark'], ['--text-muted', '--accent-soft'], ['--text-2', '--page-dark'], ['--accent-strong', '--surface'],
  ['--accent-strong', '--accent-soft'], ['--accent-strong', '--page-dark'], ['--on-accent', '--accent-strong'],
  ['--success', '--success-soft'], ['--danger', '--danger-soft'], ['--warn', '--warn-soft']];

module.exports = async function main() {
  // helpers behave
  assert.strictEqual(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.strictEqual(Math.round(contrastRatio('#ffffff', '#ffffff')), 1);
  assert.strictEqual(
    stripReducedMotion('a{b:c}@media (prefers-reduced-motion: reduce){.x{y:z !important}.q{r:s}}d{e:f}'),
    'a{b:c}d{e:f}'
  );
  assert.deepStrictEqual(parseRootTokens(':root { --a: 1px; --b: clamp(1px, 2vw, 3px); }\n.x { --c: 3; }'), { '--a': '1px', '--b': 'clamp(1px, 2vw, 3px)' });

  // every design token exists in styles.css
  const tokens = parseRootTokens(read('styles.css'));
  const missing = REQUIRED.filter(name => !(name in tokens));
  assert.deepStrictEqual(missing, [], `styles.css :root is missing tokens: ${missing.join(', ')}`);

  // every text/surface pair meets 4.5:1, including the darkest page-gradient stop
  for (const [fg, bg] of PAIRS) {
    for (const name of [fg, bg]) {
      assert.match(tokens[name], /^#[0-9a-f]{6}$/i, `${name} must be a 6-digit hex colour to be contrast-checked`);
    }
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    assert.ok(ratio >= 4.5, `${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, needs 4.5:1`);
  }

  // stylesheet lint
  lintCss('popup.css');
};
