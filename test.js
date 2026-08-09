// test.js — runs every suite in tests/. Usage: node test.js [filter]
const fs = require('fs');

async function main() {
  const filter = process.argv[2] || '';
  const files = fs.readdirSync('tests')
    .filter(f => f.endsWith('.test.js') && f.includes(filter))
    .sort();
  if (files.length === 0) {
    console.error(`No test files match "${filter}"`);
    process.exit(1);
  }
  let failed = 0;
  for (const file of files) {
    try {
      await require(`./tests/${file}`)();
      console.log(`ok   ${file}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${file}`);
      console.error(err);
    }
  }
  if (failed > 0) { console.error(`${failed} test file(s) failed`); process.exit(1); }
  console.log('all tests passed');
}

main();
