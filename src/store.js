// Tiny JSON-file database. Good enough for a single-process bot.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

let db = { guilds: {} };
let dirty = false;

function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!db.guilds) db.guilds = {};
  } catch (err) {
    console.error('[store] could not read db, starting fresh:', err.message);
    db = { guilds: {} };
  }
}

function save() {
  if (!dirty) return;
  dirty = false;
  const tmp = FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[store] save failed:', err.message);
  }
}

function markDirty() {
  dirty = true;
}

const GUILD_DEFAULTS = () => ({
  channels: {}, // key -> channel id (set by /setup)
  roles: {}, // key -> role id
  users: {}, // user id -> profile
  banter: { paused: false, lastDropIn: {}, backOff: {}, daily: {} },
  wars: { month: null, points: {} },
  counting: { current: 0, lastUser: null, best: 0 },
  wordchain: { lastWord: null, lastUser: null, used: [] },
  starboard: {},
  giveaways: {},
  tempVcs: {},
  wordleDaily: {},
  reactionPanels: {},
  channelRules: {}, // channel id -> [{ rule, ...options }]
  tempBans: {}, // user id -> { until, reason }
  antispam: { enabled: true, blockInvites: true },
  levelRoles: null, // [{ level, roleId }] — null = use the template ladder
  console: [], // recent console conversation for context
  reports: {},
});

function guild(id) {
  if (!db.guilds[id]) {
    db.guilds[id] = { ...GUILD_DEFAULTS(), _v2: true };
    markDirty();
  } else if (!db.guilds[id]._v2) {
    // Fill in fields added in newer versions
    const defaults = GUILD_DEFAULTS();
    for (const [k, v] of Object.entries(defaults)) if (db.guilds[id][k] === undefined) db.guilds[id][k] = v;
    db.guilds[id]._v2 = true;
    markDirty();
  }
  return db.guilds[id];
}

function user(guildId, userId) {
  const g = guild(guildId);
  if (!g.users[userId]) {
    g.users[userId] = {
      xp: 0,
      level: 0,
      messages: 0,
      lastXp: 0,
      coins: 0,
      lastDaily: 0,
      streak: 0,
      fish: { rod: 'twig', location: 'pond', bag: {}, caught: 0, index: [] },
      wordle: { played: 0, won: 0, streak: 0, best: 0, lastDaily: null },
      slayer: 0,
    };
    markDirty();
  }
  return g.users[userId];
}

load();
setInterval(save, 5000).unref();
process.on('exit', save);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    save();
    process.exit(0);
  });
}

module.exports = { guild, user, save, markDirty, get raw() { return db; } };
