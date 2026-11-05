// Runs the full /setup build against a fake in-memory Discord server.
process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'kinga-setup-' + process.pid);
const test = require('node:test');
const assert = require('node:assert');
const { Collection, ChannelType } = require('discord.js');

let nextId = 100000000000000000n;
const id = () => String(nextId++);

function fakeGuild() {
  const guild = { id: id(), name: 'Test Server', ownerId: 'owner', sent: [], messages: [] };
  const roles = new Collection();
  const channels = new Collection();
  const mkRole = (data) => {
    const r = { id: data.id || id(), name: data.name, position: data.position ?? roles.size, editable: data.editable ?? true, managed: !!data.managed, ...data,
      edit: async (d) => Object.assign(r, d), delete: async () => roles.delete(r.id) };
    roles.set(r.id, r);
    return r;
  };
  const everyone = mkRole({ id: guild.id, name: '@everyone', position: 0, editable: false });
  everyone.permissions = { has: () => true };
  const botRole = mkRole({ name: 'King A', position: 50, managed: true, editable: false });
  const mkChannel = (data) => {
    const ch = {
      id: id(), guild, deletable: true, parentId: data.parent || null, position: data.position ?? 0, ...data,
      isTextBased: () => (data.type ?? 0) === ChannelType.GuildText,
      isVoiceBased: () => data.type === ChannelType.GuildVoice,
      edit: async (d) => Object.assign(ch, d),
      setName: async (n) => (ch.name = n),
      delete: async () => channels.delete(ch.id),
      send: async (payload) => {
        guild.sent.push({ channel: ch.name, payload });
        const m = { id: id(), reactions: [], pin: async () => {}, startThread: async () => {}, react: async (e) => m.reactions.push(e) };
        guild.messages.push(m);
        return m;
      },
      messages: { fetch: async () => new Collection() },
      members: new Collection(),
    };
    channels.set(ch.id, ch);
    return ch;
  };
  // A brand-new server comes with these
  const textCat = mkChannel({ name: 'Text Channels', type: ChannelType.GuildCategory });
  mkChannel({ name: 'general', type: ChannelType.GuildText, parent: textCat.id });
  mkRole({ name: 'Old Role', position: 3 });

  guild.roles = {
    cache: roles, everyone,
    fetch: async () => roles,
    create: async (d) => mkRole({ ...d, position: 1 }),
    setPositions: async (list) => list.forEach((p) => (roles.get(p.role).position = p.position)),
  };
  guild.channels = { cache: channels, fetch: async () => channels, create: async (d) => mkChannel(d) };
  guild.members = {
    me: { id: 'bot', roles: { highest: botRole }, permissions: { has: () => true } },
    cache: new Collection(),
    fetch: async () => new Collection(),
  };
  guild.edit = async (d) => (guild.settings = d);
  guild.autoModerationRules = { rules: [], fetch: async () => new Collection(), create: async (r) => guild.autoModerationRules.rules.push(r) };
  guild.iconURL = () => null;
  guild.memberCount = 1;
  return guild;
}

test('fresh /setup builds the full server', async () => {
  const tpl = require('../src/setup/template');
  const { runSetup } = require('../src/setup/runner');
  const store = require('../src/store');
  const guild = fakeGuild();
  const steps = [];
  const report = await runSetup(guild, { fresh: true, onProgress: async (s) => steps.push(s) });

  const expectedChannels = tpl.categories.reduce((n, c) => n + 1 + c.channels.length, 0);
  assert.strictEqual(report.channelsCreated, expectedChannels);
  assert.strictEqual(guild.channels.cache.size, expectedChannels, 'old channels removed');
  assert.ok(!guild.channels.cache.find((c) => c.name === 'general'), 'default #general wiped');
  assert.ok(!guild.roles.cache.find((r) => r.name === 'Old Role'), 'old role wiped');
  assert.ok(guild.roles.cache.find((r) => r.name === 'King A'), 'bot role kept');
  assert.deepStrictEqual(report.warnings, []);

  const g = store.guild(guild.id);
  for (const cat of tpl.categories) for (const ch of cat.channels) assert.ok(g.channels[ch.key], `channel key ${ch.key} saved`);

  // Staff category hidden from @everyone
  const staffCat = guild.channels.cache.get(g.channels.cat_staff);
  const ev = staffCat.permissionOverwrites.find((o) => o.id === guild.id);
  assert.ok(ev.deny.length, 'staff hidden');
  // Valorant section is opt-in
  const valo = guild.channels.cache.get(g.channels.cat_valorant);
  assert.ok(valo.permissionOverwrites.find((o) => o.id === g.roles.g_valorant), 'valorant role can see');

  const posted = guild.sent.map((s) => s.channel);
  for (const name of ['📜・rules', '🎭・self-roles', '👋・welcome', '🛡️・mod-chat', '🕹️・game-room']) assert.ok(posted.includes(name), `posted in ${name}`);
  assert.strictEqual(guild.autoModerationRules.rules.length, 2);

  // Reaction-role panels: one message per category with every emoji reacted
  const panels = Object.entries(g.reactionPanels);
  assert.strictEqual(panels.length, tpl.selfRoleCategories.length);
  for (const [msgId, catKey] of panels) {
    const m = guild.messages.find((x) => x.id === msgId);
    const cat = tpl.selfRoleCategories.find((c) => c.key === catKey);
    assert.deepStrictEqual(m.reactions, cat.options.map((o) => o.emoji));
  }
  assert.strictEqual(guild.settings.verificationLevel, 2);

  // Running again in add mode creates nothing new
  const again = await runSetup(guild, { fresh: false });
  assert.strictEqual(again.channelsCreated, 0);
  assert.strictEqual(again.rolesCreated, 0);
});

test('reaction roles: add, remove, and pick-one swapping', async () => {
  const store = require('../src/store');
  const { handle } = require('../src/features/reactionroles');
  const gid = 'g-react';
  const g = store.guild(gid);
  Object.assign(g.roles, { team_pc: 'r-pc', team_mobile: 'r-mob', g_valorant: 'r-valo', g_bgmi: 'r-bgmi' });
  g.reactionPanels = { 'm-side': 'side', 'm-games': 'games' };

  const has = new Set();
  const member = { roles: { cache: { has: (id) => has.has(id) }, add: async (r) => has.add(r.id), remove: async (r) => has.delete(r.id) } };
  const roles = new Map(['r-pc', 'r-mob', 'r-valo', 'r-bgmi'].map((id) => [id, { id }]));
  const guild = { id: gid, roles: { cache: roles }, channels: { cache: new Map() }, members: { fetch: async () => member } };
  const removedReactions = [];
  const mkMsg = (id, emojis) => {
    const msg = { id, guild, reactions: { cache: [] } };
    msg.reactions.cache = emojis.map((e) => ({ emoji: { name: e }, users: { remove: async (u) => removedReactions.push(e) } }));
    return msg;
  };
  const side = mkMsg('m-side', ['🖥️', '📱', '🎮', '🏳️']);
  const games = mkMsg('m-games', ['🎯', '🔫']);
  const react = (msg, emoji, added) => handle({ partial: false, emoji: { name: emoji }, message: msg, users: { remove: async () => removedReactions.push('stray') } }, { id: 'u1', bot: false }, added);

  await react(games, '🎯', true);
  await react(games, '🔫', true);
  assert.ok(has.has('r-valo') && has.has('r-bgmi'), 'multi-pick category keeps both');
  await react(games, '🎯', false);
  assert.ok(!has.has('r-valo') && has.has('r-bgmi'), 'unreact removes role');

  await react(side, '🖥', true); // without variation selector, as Discord sometimes sends it
  assert.ok(has.has('r-pc'));
  await react(side, '📱', true);
  assert.ok(has.has('r-mob') && !has.has('r-pc'), 'pick-one category swaps role');
  assert.ok(removedReactions.includes('🖥️'), 'old reaction removed');

  await react(side, '😂', true);
  assert.ok(!removedReactions.includes('stray'), 'unknown emoji left alone');
  assert.ok(has.has('r-mob'), 'roles untouched by unknown emoji');
});

test('dropdown picks toggle instead of wiping the category', () => {
  const tpl = require('../src/setup/template');
  const { planSelect } = require('../src/commands/roles');
  const games = tpl.selfRoleCategories.find((c) => c.key === 'games');
  const side = tpl.selfRoleCategories.find((c) => c.key === 'side');
  const owned = new Set(['g_valorant']);
  const roleFor = (k) => ({ id: k });
  const has = (r) => owned.has(r.id);

  // Already has Valorant, picks BGMI from the reset menu → BGMI added, Valorant kept
  let p = planSelect(games, ['g_bgmi'], roleFor, has);
  assert.deepStrictEqual(p.add.map((r) => r.id), ['g_bgmi']);
  assert.deepStrictEqual(p.remove, []);
  // Picking Valorant again removes it
  p = planSelect(games, ['g_valorant'], roleFor, has);
  assert.deepStrictEqual(p.remove.map((r) => r.id), ['g_valorant']);
  // Pick-one: switching side swaps
  owned.add('team_pc');
  p = planSelect(side, ['team_mobile'], roleFor, has);
  assert.deepStrictEqual([p.add.map((r) => r.id), p.remove.map((r) => r.id)], [['team_mobile'], ['team_pc']]);
});
