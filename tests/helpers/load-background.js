// Loads background.js into the current process with logic.js helpers exposed.
const fs = require('fs');
const path = require('path');
const logic = require('../../logic.js');

module.exports = function loadBackground() {
  Object.assign(globalThis, logic);
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'background.js'), 'utf8')
    .replace(/^\uFEFF?importScripts\([^)]*\);\s*/, '');
  (0, eval)(source + '\n;globalThis.HANDLERS = HANDLERS;');
};