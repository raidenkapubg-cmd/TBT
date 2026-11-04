// Sanity check without connecting to Discord: loads every module and validates slash command definitions.
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'x';
process.env.DATA_DIR = process.env.DATA_DIR || require('path').join(require('os').tmpdir(), 'kinga-check');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'commands');
const names = new Set();
let count = 0;
for (const file of fs.readdirSync(dir)) {
  const mod = require(path.join(dir, file));
  for (const cmd of [].concat(mod.commands || mod)) {
    const json = cmd.data.toJSON();
    if (names.has(json.name)) throw new Error(`Duplicate command ${json.name}`);
    names.add(json.name);
    count++;
  }
}
for (const f of fs.readdirSync(path.join(__dirname, '..', 'src', 'features'))) require(path.join(__dirname, '..', 'src', 'features', f));
require('../src/setup/runner');
const content = require('../src/setup/content');
content.selfRolesPanel().components.forEach((r) => r.toJSON());
console.log(`✅ ${count} slash commands valid: ${[...names].join(', ')}`);
process.exit(0);
