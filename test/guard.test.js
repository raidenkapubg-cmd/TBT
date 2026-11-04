process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'kinga-guard-' + process.pid);
const test = require('node:test');
const assert = require('node:assert');
const { Collection, PermissionFlagsBits } = require('discord.js');
const store = require('../src/store');
const guard = require('../src/features/guard');
const levels = require('../src/features/levels');
const actions = require('../src/features/actions');

function fakeMsg({ guildId, channelId, content = '', attachments = 0, staff = false }) {
  const events = { deleted: false, banned: null, sent: [], reacted: [] };
  const guild = {
    id: guildId, name: 'Test', roles: { everyone: { id: guildId } }, channels: { cache: new Collection() },
    invites: { fetch: async () => null }, members: { unban: async () => {} },
  };
  const member = {
    id: 'u1', guild, user: { tag: 'spammer#0001', createdTimestamp: Date.now() - 1e10 },
    permissions: { has: (p) => staff && p === PermissionFlagsBits.Administrator },
    displayName: 'Spammer', send: async () => {}, ban: async (o) => (events.banned = o), kick: async () => (events.kicked = true), timeout: async (ms) => (events.timeout = ms),
  };
  const msg = {
    id: 'm' + Math.random(), guild, member, author: { id: 'u1', tag: 'spammer#0001' }, content,
    attachments: new Collection(Array.from({ length: attachments }, (_, n) => [String(n), {}])), stickers: new Collection(),
    channel: { id: channelId, name: 'trap', send: async (t) => { events.sent.push(t); return { delete: async () => {} }; } },
    delete: async () => (events.deleted = true), react: async (e) => events.reacted.push(e), startThread: async () => (events.thread = true),
  };
  return { msg, events };
}

test('trap channel temp-bans posters for 7 days and records the auto-unban', async () => {
  const gid = 'g-trap';
  guard.setRule({ id: gid }, 'c-trap', { rule: 'trap', action: 'tempban', days: 7 });
  const { msg, events } = fakeMsg({ guildId: gid, channelId: 'c-trap', content: 'free nitro https://scam.link' });
  const init = guard.init.toString(); // ensure module loaded
  assert.ok(init);
  // call the rules engine through the message handler
  const handlers = [];
  guard.init({ on: (ev, fn) => handlers.push([ev, fn]), once: () => {} });
  await handlers.find(([ev]) => ev === 'messageCreate')[1](msg);
  assert.ok(events.deleted, 'message deleted');
  assert.strictEqual(events.banned.deleteMessageSeconds, 86400, 'wipes last day of messages');
  const tb = store.guild(gid).tempBans.u1;
  assert.ok(tb && Math.abs(tb.until - (Date.now() + 7 * 86400000)) < 5000, 'auto-unban in 7 days');
});

test('trap ignores staff', async () => {
  const gid = 'g-trap2';
  guard.setRule({ id: gid }, 'c', { rule: 'trap' });
  const { msg, events } = fakeMsg({ guildId: gid, channelId: 'c', content: 'testing', staff: true });
  const handlers = [];
  guard.init({ on: (ev, fn) => handlers.push([ev, fn]), once: () => {} });
  await handlers.find(([ev]) => ev === 'messageCreate')[1](msg);
  assert.ok(!events.banned && !events.deleted);
});

test('media-only, auto-react and one-post rules', async () => {
  const gid = 'g-media';
  guard.setRule({ id: gid }, 'c', { rule: 'media_only' });
  guard.setRule({ id: gid }, 'c', { rule: 'auto_react', emojis: ['🔥'] });
  const handlers = [];
  guard.init({ on: (ev, fn) => handlers.push([ev, fn]), once: () => {} });
  const run = handlers.find(([ev]) => ev === 'messageCreate')[1];

  const text = fakeMsg({ guildId: gid, channelId: 'c', content: 'just words' });
  await run(text.msg);
  assert.ok(text.events.deleted, 'text-only post removed');
  const pic = fakeMsg({ guildId: gid, channelId: 'c', content: '', attachments: 1 });
  await run(pic.msg);
  assert.ok(!pic.events.deleted);
  assert.deepStrictEqual(pic.events.reacted, ['🔥']);

  guard.setRule({ id: gid }, 'intro', { rule: 'one_message' });
  const a = fakeMsg({ guildId: gid, channelId: 'intro', content: 'hi im new' });
  await run(a.msg);
  const b = fakeMsg({ guildId: gid, channelId: 'intro', content: 'me again' });
  await run(b.msg);
  assert.ok(!a.events.deleted && b.events.deleted, 'second post removed');
  assert.ok(guard.listRules({ id: gid, channels: { cache: new Map([['c', { toString: () => '#c' }], ['intro', { toString: () => '#intro' }]]) } }).length === 3);
});

test('XP ignores spam but rewards real chat', () => {
  const u = { lastXp: 0 };
  const now = Date.now();
  assert.strictEqual(levels.xpBlockReason('x1', u, 'ok', now), 'too short');
  assert.strictEqual(levels.xpBlockReason('x1', u, 'aaaaaaaaaa', now), 'repeated characters');
  assert.strictEqual(levels.xpBlockReason('x1', u, 'that clutch was insane ngl', now), null);
  levels.remember('x1', 'that clutch was insane ngl', now);
  assert.strictEqual(levels.xpBlockReason('x1', u, 'that clutch was insane ngl', now + 70000), 'duplicate');
  u.lastXp = now;
  assert.strictEqual(levels.xpBlockReason('x1', u, 'something new to say', now + 1000), 'cooldown');
  // flood
  for (let n = 0; n < 5; n++) levels.remember('x2', `msg number ${n}`, now + n);
  const v = { lastXp: 0 };
  assert.strictEqual(levels.xpBlockReason('x2', v, 'another real message', now + 100), 'flood');
  assert.ok(v.xpMutedUntil > now, 'XP paused after flooding');
  assert.strictEqual(levels.totalXpForLevel(levels.levelFromXp(5000).level) <= 5000, true);
});

test('friendly permission names', () => {
  assert.strictEqual(actions.permName('send messages'), 'SendMessages');
  assert.strictEqual(actions.permName('view'), 'ViewChannel');
  assert.strictEqual(actions.permName('SendMessages'), 'SendMessages');
  assert.strictEqual(actions.permName('attach files'), 'AttachFiles');
  assert.throws(() => actions.permName('fly'));
});
