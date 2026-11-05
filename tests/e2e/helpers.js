// Shared helpers for the Chromium e2e flows.
const assert = require('assert');

// Fails if any visible text on the page renders below `min` px, listing every offender.
async function assertMinFontSize(page, label, min = 11) {
  const offenders = await page.evaluate((floor) => {
    const bad = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim();
      const el = node.parentElement;
      if (!text || !el) continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue;
      const size = parseFloat(style.fontSize);
      if (size < floor) bad.push(`<${el.tagName.toLowerCase()}${el.id ? ' #' + el.id : ''}${el.className ? ' .' + String(el.className).split(' ')[0] : ''}> "${text.slice(0, 30)}" is ${size}px`);
    }
    return bad;
  }, min);
  assert.deepStrictEqual(offenders, [], `${label}: text below ${min}px: ${offenders.join('; ')}`);
}

module.exports = { assertMinFontSize };
