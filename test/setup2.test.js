// /setup2 against a fake copy of an established server (layout from real screenshots).
process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'kinga-setup2-' + process.pid);
process.env.BRAND_NAME = 'Brand';
const test = require('node:test');
const assert = require('node:assert');
const { Collection, ChannelType, PermissionFlagsBits: P, SnowflakeUtil } = require('discord.js');

let n = 1000;
const DAY = 86400000;
const snow = (ago) => SnowflakeUtil.generate({ timestamp: Date.now() - ago }).toString();

function server() {
  const guild = { id: 'g-s2', name: 'Brand Official', sent: [] };
  const channels = new Collection();
  const roles = new Collection();
  const role = (name, extra = {}) => {
    const r = { id: String(n++), name, position: roles.size, managed: false, editable: true, permissions: { has: () => true, add: (x) => x }, ...extra, delete: async () => roles.delete(r.id), setPermissions: async () => {} };
    roles.set(r.id, r);
    return r;
  };
  const everyone = role('@everyone', { id: guild.id });
  const bot = role('King A', { managed: true, position: 99 });

  const mk = (name, type, parent, { view = true, send = true, active = 1 * DAY } = {}) => {
    const ch = {
      id: String(n++), name, type, parentId: parent?.id ?? null, rawPosition: channels.size, position: channels.size, topic: null, guild,
      lastMessageId: active === null ? null : snow(active),
      flags: { view, send },
      origView: view,
      isThread: () => false,
      permissionOverwrites: { cache: new Collection() },
      permissionsFor: () => ({ has: (p) => (p === P.ViewChannel ? ch.flags.view : ch.flags.send) }),
      edit: async (o) => {
        if (o.name) ch.name = o.name;
        if ('parent' in o) ch.parentId = o.parent ?? null;
        if (o.topic !== undefined) ch.topic = o.topic;
        if (o.permissionOverwrites) {
          ch.permissionOverwrites.cache = new Collection(o.permissionOverwrites.map((x) => [x.id, { id: x.id, type: x.type ?? 0, allow: { bitfield: BigInt([].concat(x.allow || []).reduce((a, b) => a | BigInt(b), 0n)) }, deny: { bitfield: BigInt([].concat(x.deny || []).reduce((a, b) => a | BigInt(b), 0n)) } }]));
          const ev = o.permissionOverwrites.find((x) => x.id === guild.id);
          ch.flags.view = ev ? !(BigInt([].concat(ev.deny || []).reduce((a, b) => a | BigInt(b), 0n)) & P.ViewChannel) : ch.origView;
        }
        return ch;
      },
      delete: async () => channels.delete(ch.id),
      setName: async (x) => (ch.name = x),
      send: async (p) => {
        guild.sent.push([ch.name, p]);
        return { id: String(n++), pin: async () => {}, react: async () => {} };
      },
      messages: { fetch: async () => new Collection() },
    };
    channels.set(ch.id, ch);
    return ch;
  };
  const T = ChannelType.GuildText, V = ChannelType.GuildVoice, C = ChannelType.GuildCategory, F = ChannelType.GuildForum, A = ChannelType.GuildAnnouncement;
  const old = 60 * DAY;

  const dash = mk('DASHBOARD', C);
  mk('👋 | welcome', A, dash, { send: false });
  mk('👋 | rules', T, dash, { send: false });
  mk('🟣 | about-brand', T, dash, { send: false });
  mk('🎭 | self-roles', T, dash, { send: false });
  const ann = mk('ANNOUNCEMENTS', C);
  mk('📢 | announcements', A, ann, { send: false });
  mk('📺 | youtube', A, ann, { send: false });
  const lounge = mk('LOUNGE', C);
  mk('type-rift-contest', T, lounge, { active: old });
  mk('💭 | general', T, lounge);
  mk('🏎️ | f1', T, lounge);
  mk('💭 | gen-bot-cmd', T, lounge);
  mk('🎭 | content', F, lounge);
  mk('🎭 | posts', F, lounge, { active: old });
  mk('💡 | server-suggestions', F, lounge);
  const lobby = mk('Brand Lobby', C);
  mk('event-announcement', A, lobby, { send: false });
  mk('📱 | setup-wars-valorant-edition', F, lobby, { active: old });
  mk('📱 | setup-wars-ogs', F, lobby, { active: old });
  mk('event-chat', T, lobby, { active: old });
  const cvc = mk('Brand Custom Voice Channels', C);
  mk('voice-control', T, cvc, { active: old });
  mk('➕ Create VC', V, cvc);
  mk('⏳ Waiting Room', V, cvc);
  const voice = mk('Voice Channels', C);
  mk('Scribble VC', V, voice);
  mk('Chill', V, voice);
  mk('AFK', V, voice);
  const sup = mk('🛠 SUPPORT & BRAND PRODUCTS', C);
  mk('🔧 | product-support-n-queries', T, sup);
  mk('🔧 | product-faq', T, sup, { send: false, active: old });
  mk('💡 | support', F, sup);
  mk('💡 | product-reviews-suggestions', F, sup);
  const kcap = mk('KCap United', C, null, { view: false });
  mk('gc', T, kcap, { view: false });
  mk('Kcap', V, kcap, { view: false });
  const admin = mk('Admin', C, null, { view: false });
  mk('📜 | server-logs', T, admin, { view: false });
  mk('📜 | message-logs', T, admin, { view: false });
  mk('📜 | leave-logs', T, admin, { view: false });
  const stats = mk('📊 Server Stats 📊', C);
  mk('Member Count: 3063', V, stats, { send: false });
  mk('Bot Count: 6', V, stats, { send: false });
  mk('Role Count: 66', V, stats, { send: false });
  role('Moderator');

  guild.roles = { cache: roles, everyone, fetch: async () => roles, create: async (d) => role(d.name) };
  guild.channels = {
    cache: channels,
    fetch: async () => channels,
    create: async (d) => {
      const ch = mk(d.name, d.type, d.parent ? { id: d.parent } : null, { active: null });
      if (d.permissionOverwrites) await ch.edit({ permissionOverwrites: d.permissionOverwrites });
      return ch;
    },
    setPositions: async () => {},
  };
  guild.members = { me: { id: 'bot', roles: { highest: bot }, permissions: { has: () => true } }, cache: new Collection(), fetch: async () => new Collection() };
  guild.autoModerationRules = { fetch: async () => new Collection(), create: async () => {} };
  guild.iconURL = () => null;
  guild.memberCount = 3063;
  return { guild, channels };
}

const byName = (channels, re) => channels.find((c) => re.test(c.name));

test('/setup2 plan matches, hides and keeps the right channels', async () => {
  const { plan } = require('../src/setup/reorganize');
  const { guild } = server();
  const p = plan(guild, { inactiveDays: 14 });
  const reused = Object.fromEntries(p.reuse.map((r) => [r.key, r.ch.name]));
  assert.strictEqual(reused.welcome, '👋 | welcome');
  assert.strictEqual(reused.about, '🟣 | about-brand');
  assert.strictEqual(reused.bot_commands, '💭 | gen-bot-cmd');
  assert.strictEqual(reused.content, '📺 | youtube');
  assert.strictEqual(reused.feedback, '💡 | server-suggestions');
  assert.strictEqual(reused.support, '🔧 | product-support-n-queries');
  assert.strictEqual(reused.reviews, '💡 | product-reviews-suggestions');
  assert.strictEqual(reused.event_news, 'event-announcement');
  assert.strictEqual(reused.create_vc, '➕ Create VC');
  assert.strictEqual(reused.stat_members, 'Member Count: 3063');
  assert.strictEqual(reused.server_logs, '📜 | server-logs');

  const hidden = p.hide.map((h) => h.ch.name);
  for (const name of ['type-rift-contest', '📱 | setup-wars-valorant-edition', '📱 | setup-wars-ogs', 'voice-control']) assert.ok(hidden.includes(name), `hides ${name}`);
  const kept = p.keep.map((k) => k.ch.name);
  for (const name of ['🏎️ | f1', 'gc', 'Kcap', 'Scribble VC', '⏳ Waiting Room', '🔧 | product-faq']) assert.ok(kept.includes(name), `keeps ${name}`);

  const cats = Object.fromEntries(p.catReuse.map((c) => [c.key, c.cat.name]));
  assert.strictEqual(cats.cat_start, 'DASHBOARD');
  assert.strictEqual(cats.cat_events, 'Brand Lobby');
  assert.strictEqual(cats.cat_voice, 'Voice Channels');
  assert.strictEqual(cats.cat_gear, '🛠 SUPPORT & BRAND PRODUCTS');
  assert.strictEqual(cats.cat_staff, 'Admin');
  assert.ok(p.roleReuse.some((r) => r.key === 'mod' && r.role.name === 'Moderator'), 'reuses existing Moderator role');

  // force options
  const p2 = plan(guild, { hide: ['f1'], keep: ['type-rift-contest'] });
  assert.ok(p2.hide.some((h) => h.ch.name === '🏎️ | f1'));
  assert.ok(p2.keep.some((k) => k.ch.name === 'type-rift-contest'));
});

test('/setup2 apply edits in place, then undo restores everything', async () => {
  const { apply, undo, ARCHIVE_NAME } = require('../src/setup/reorganize');
  const { guild, channels } = server();
  const before = new Map([...channels.values()].map((c) => [c.id, { name: c.name, parentId: c.parentId }]));
  const general = byName(channels, /general/);
  const { report } = await apply(guild, {});
  assert.deepStrictEqual(report.warnings, []);

  // nothing that existed was deleted except empty categories
  for (const [id] of before) {
    const wasCategory = before.get(id) && channels.get(id) === undefined;
    if (wasCategory) assert.ok(require('../src/store').guild(guild.id).setup2Backup.deletedCategories.some((c) => c.id === id), 'removed only empty categories, with backup');
  }
  assert.strictEqual(channels.get(general.id).name, '💬・general', 'renamed in place (same channel, messages kept)');
  const archive = byName(channels, new RegExp(ARCHIVE_NAME));
  assert.ok(archive, 'archive category made');
  assert.strictEqual(byName(channels, /type-rift-contest/).parentId, archive.id, 'hidden in archive');
  assert.strictEqual(byName(channels, /type-rift-contest/).flags.view, false, 'hidden from @everyone');
  assert.ok(byName(channels, /king-a-console/), 'missing channels created');
  assert.ok(guild.sent.some(([name]) => /king-a-console/.test(name)), 'posted in new console');
  assert.ok(!guild.sent.some(([name]) => /rules/.test(name)), 'did not post into the existing rules channel');

  const r = await undo(guild);
  assert.ok(r.restored > 10);
  for (const [id, b] of before) {
    const c = channels.get(id);
    assert.ok(c, `${b.name} exists after undo`);
    if (c.type !== ChannelType.GuildCategory) assert.strictEqual(c.name, b.name, `${b.name} name restored`);
  }
  assert.ok(!byName(channels, /king-a-console/), 'created channels removed by undo');
  assert.strictEqual(byName(channels, /type-rift-contest/).flags.view, true, 'un-hidden by undo');
});
