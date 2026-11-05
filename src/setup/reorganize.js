// /setup2 — reorganize an existing server into the template WITHOUT wiping it.
// Matches existing channels/categories/roles by name, renames + moves + fixes permissions,
// hides unused channels in an archive (nothing is deleted except empty categories), creates what's missing,
// and keeps a backup so /setup2 undo can put everything back.
const { ChannelType, PermissionFlagsBits, SnowflakeUtil } = require('discord.js');
const config = require('../config');
const store = require('../store');
const tpl = require('./template');
const content = require('./content');
const { overwritesFor, allRoleSpecs, safeSettings } = require('./runner');

const P = PermissionFlagsBits;
const ARCHIVE_NAME = '🗄️ ARCHIVE';

/** "💭 | general" -> "general", "🛠 SUPPORT & BRAND PRODUCTS" -> "support-brand-products" */
function plain(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

const S = config.brandSlug;

// Other names an existing channel might have for each template channel.
const CHANNEL_ALIASES = {
  welcome: ['welcome', 'welcomes', 'arrivals', 'joins'],
  rules: ['rules', 'server-rules', 'guidelines', 'rules-and-info'],
  about: ['about', `about-${S}`, 'about-us', 'info', 'information', 'server-info'],
  self_roles: ['self-roles', 'roles', 'get-roles', 'reaction-roles', 'pick-roles'],
  introductions: ['introductions', 'introduce-yourself', 'intros', 'intro'],
  announcements: ['announcements', 'announcement', 'news', 'updates'],
  drops: ['deals-and-drops', 'deals', 'drops', 'offers', 'sales', 'discounts'],
  event_news: ['events', 'event-announcement', 'event-announcements', 'event-news'],
  content: ['content-drops', 'youtube', 'socials', 'instagram', 'videos', 'social-media'],
  general: ['general', 'general-chat', 'chat', 'main-chat'],
  memes: ['memes', 'meme', 'shitposting'],
  clips: ['clips', 'highlights', 'content', 'posts', 'media'],
  setups: ['setups', 'setup', 'battlestations', 'battlestation', 'desk-setups'],
  wars: ['pc-vs-mobile'],
  qotd: ['question-of-the-day', 'qotd'],
  hall_of_fame: ['hall-of-fame', 'starboard', 'best-of'],
  level_ups: ['level-ups', 'levels', 'rank-ups', 'level-up'],
  bot_commands: ['bot-commands', 'gen-bot-cmd', 'bot-cmd', 'bot-cmds', 'commands', 'bots', 'bot-spam'],
  activities: ['game-room', 'activities'],
  wordle: ['wordle'],
  games: ['games', 'mini-games', 'minigames'],
  counting: ['counting', 'count'],
  word_chain: ['word-chain', 'wordchain'],
  product_talk: ['product-talk', 'product-discussion', 'products', 'gear-talk', `${S}-talk`],
  support: ['support', 'product-support', 'product-support-n-queries', 'help', 'help-desk', 'queries'],
  feedback: ['feedback-and-ideas', 'feedback', 'suggestions', 'server-suggestions', 'ideas'],
  reviews: ['member-reviews', 'reviews', 'product-reviews', 'product-reviews-suggestions', 'product-reviews-suggestion'],
  event_chat: ['event-chat', 'events-chat'],
  registrations: ['registrations', 'registration', 'register', 'signups', 'sign-ups'],
  brackets: ['brackets', 'bracket', 'results'],
  event_lobby: ['event-lobby', 'event-stage', 'stage'],
  valo_chat: ['valo-chat', 'valorant-chat', 'valorant'],
  lfg_unrated: ['lfg-unrated', 'unrated-lfg'],
  lfg_ranked: ['lfg-ranked', 'ranked-lfg'],
  game_chat: ['game-chat', 'gaming-chat', 'other-games'],
  lfg: ['lfg', 'looking-for-group', 'find-teammates'],
  insider_lounge: ['insider-lounge', 'insiders'],
  create_vc: ['create-vc', 'join-to-create', 'create-a-vc', 'create-voice'],
  hangout: ['community-hangout', 'hangout', 'lounge'],
  chill: ['chill', 'chill-vc'],
  night_shift: ['night-shift'],
  afk: ['afk'],
  mod_chat: ['mod-chat', 'staff-chat', 'mods', 'moderators', 'staff'],
  console: ['king-a-console'],
  reports: ['reports', 'mod-reports', 'user-reports'],
  server_logs: ['server-logs', 'mod-logs', 'logs', 'audit-log', 'audit-logs'],
  message_logs: ['message-logs', 'msg-logs', 'chat-logs'],
  leave_logs: ['leave-logs', 'join-leave', 'join-leave-logs', 'member-logs'],
  bot_logs: ['bot-logs'],
  stat_members: [/^(all-)?members?(-count)?(-\d+)?$/],
  stat_humans: [/^(users?|humans?)(-count)?(-\d+)?$/],
  stat_bots: [/^bots?(-count)?(-\d+)?$/],
  stat_boosts: [/^boosts?(-count)?(-\d+)?$/],
};

const CATEGORY_ALIASES = {
  cat_stats: ['server-stats', 'stats', 'statistics'],
  cat_start: ['start-here', 'dashboard', 'information', 'info', 'welcome', 'important'],
  cat_news: ['news', 'announcements'],
  cat_lounge: ['lounge', 'community', 'chat', 'general', 'text-channels'],
  cat_arcade: ['arcade', 'games', 'fun', 'mini-games'],
  cat_gear: [`${S}-gear`, 'gear', 'support', 'products', 'support-products'],
  cat_events: ['events', 'event', 'tournaments', 'lobby'],
  cat_valorant: ['valorant'],
  cat_other_games: ['other-games', 'gaming'],
  cat_insiders: ['insiders'],
  cat_voice: ['hangout', 'voice-channels', 'voice', 'custom-voice-channels'],
  cat_staff: ['staff', 'admin', 'moderation', 'mods', 'mod'],
};

const ROLE_ALIASES = {
  admin: ['admin', 'admins', 'administrator'],
  mod: ['moderator', 'moderators', 'mod', 'mods'],
  helper: ['helper', 'helpers', 'support-team'],
  team: [`team-${S}`, `${S}-team`, 'team'],
  welcome_squad: ['welcome-squad', 'welcomer', 'welcomers', 'greeter', 'greeters'],
};

/**
 * How well a name matches a list of aliases. Exact = strong.
 * Partial ("brand-lobby" ~ "lobby") only for categories, or for multi-word aliases on channels —
 * so "setup-wars-valorant-edition" doesn't get mistaken for the Valorant chat.
 */
function score(name, aliases, { partial = 'multiword' } = {}) {
  const n = plain(name);
  let best = 0;
  for (const a of aliases) {
    if (a instanceof RegExp) {
      if (a.test(n)) best = Math.max(best, 100);
    } else if (n === a) best = Math.max(best, 100 + a.length);
    else if (a.length >= 5 && (partial === 'any' || a.includes('-')) && (n.startsWith(`${a}-`) || n.endsWith(`-${a}`) || n.includes(`-${a}-`))) {
      best = Math.max(best, 10 + a.length);
    }
  }
  return best;
}

const isVoiceType = (t) => t === ChannelType.GuildVoice || t === ChannelType.GuildStageVoice;
const isTextType = (t) => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(t);

/** Greedy best-match assignment: each template key gets at most one channel and vice versa. */
function assign(candidates, specs, aliasMap, typeOk, preferred = {}, partial = 'multiword') {
  const pairs = [];
  for (const spec of specs) {
    const own = [plain(spec.name), ...(aliasMap[spec.key] || [])];
    for (const ch of candidates) {
      if (!typeOk(spec, ch)) continue;
      let sc = score(ch.name, own, { partial });
      if (preferred[spec.key] === ch.id) sc = 1000; // already linked by a previous setup
      if (sc > 0) pairs.push({ key: spec.key, ch, sc });
    }
  }
  pairs.sort((a, b) => b.sc - a.sc);
  const byKey = {};
  const used = new Set();
  for (const p of pairs) {
    if (byKey[p.key] || used.has(p.ch.id)) continue;
    byKey[p.key] = p.ch;
    used.add(p.ch.id);
  }
  return byKey;
}

function lastActivity(ch) {
  const ids = [ch.lastMessageId, ch.id].filter(Boolean);
  return Math.max(...ids.map((id) => Number(SnowflakeUtil.timestampFrom(id))));
}

/**
 * Work out what /setup2 would do. Doesn't change anything.
 * opts: { inactiveDays, hide: [names], keep: [names], keepNames }
 */
function plan(guild, opts = {}) {
  const g = store.guild(guild.id);
  const inactiveMs = (opts.inactiveDays ?? 14) * 86400000;
  const forceHide = new Set((opts.hide || []).map(plain).filter(Boolean));
  const forceKeep = new Set((opts.keep || []).map(plain).filter(Boolean));
  const all = [...guild.channels.cache.values()].filter((c) => !c.isThread?.());
  const cats = all.filter((c) => c.type === ChannelType.GuildCategory && c.name !== ARCHIVE_NAME);
  const chans = all.filter((c) => c.type !== ChannelType.GuildCategory);
  const archived = all.find((c) => c.type === ChannelType.GuildCategory && c.name === ARCHIVE_NAME);

  const catMatch = assign(cats, tpl.categories, CATEGORY_ALIASES, () => true, g.channels, 'any');
  const specs = tpl.categories.flatMap((cat) => cat.channels.map((c) => ({ ...c, cat: cat.key })));
  const chMatch = assign(
    chans.filter((c) => !forceHide.has(plain(c.name)) && c.parentId !== archived?.id),
    specs,
    CHANNEL_ALIASES,
    (spec, ch) => (isVoiceType(spec.type ?? ChannelType.GuildText) ? isVoiceType(ch.type) : isTextType(ch.type)),
    g.channels,
  );

  const matchedIds = new Set(Object.values(chMatch).map((c) => c.id));
  const everyone = guild.roles.everyone;
  const hide = [];
  const keep = [];
  for (const ch of chans) {
    if (matchedIds.has(ch.id) || ch.parentId === archived?.id) continue;
    const n = plain(ch.name);
    const canView = ch.permissionsFor?.(everyone)?.has(P.ViewChannel) ?? true;
    const canSend = ch.permissionsFor?.(everyone)?.has(isVoiceType(ch.type) ? P.Connect : P.SendMessages) ?? true;
    let why = null;
    if (forceHide.has(n)) {
      hide.push({ ch, why: 'you asked' });
      continue;
    }
    if (forceKeep.has(n)) why = 'you asked';
    else if (!canView) why = 'private';
    else if (isVoiceType(ch.type)) why = 'voice';
    else if (!canSend) why = 'info / read-only';
    else if (Date.now() - lastActivity(ch) < inactiveMs) why = 'active recently';
    if (why) keep.push({ ch, why });
    else hide.push({ ch, why: `quiet for ${opts.inactiveDays ?? 14}+ days` });
  }

  const reuse = [];
  const create = [];
  for (const spec of specs) {
    const ch = chMatch[spec.key];
    if (ch) reuse.push({ key: spec.key, ch, spec, newName: opts.keepNames ? ch.name : spec.name });
    else create.push({ key: spec.key, spec });
  }
  const catReuse = tpl.categories.filter((c) => catMatch[c.key]).map((c) => ({ key: c.key, cat: catMatch[c.key], newName: opts.keepNames ? catMatch[c.key].name : c.name }));
  const catCreate = tpl.categories.filter((c) => !catMatch[c.key]);

  // Roles
  const roleReuse = [];
  const roleCreate = [];
  const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed);
  const takenRoles = new Set();
  for (const spec of allRoleSpecs()) {
    let r = g.roles[spec.key] && guild.roles.cache.get(g.roles[spec.key]);
    if (!r) r = roles.find((x) => !takenRoles.has(x.id) && (x.name === spec.name || plain(x.name) === plain(spec.name)));
    if (!r && ROLE_ALIASES[spec.key]) r = roles.find((x) => !takenRoles.has(x.id) && ROLE_ALIASES[spec.key].includes(plain(x.name)));
    if (r) {
      takenRoles.add(r.id);
      roleReuse.push({ key: spec.key, role: r });
    } else roleCreate.push(spec);
  }

  return { reuse, create, hide, keep, catReuse, catCreate, roleReuse, roleCreate, archived };
}

function snapshot(ch) {
  return {
    name: ch.name,
    parentId: ch.parentId ?? null,
    position: ch.rawPosition ?? ch.position ?? 0,
    topic: ch.topic ?? null,
    overwrites: [...ch.permissionOverwrites.cache.values()].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
  };
}

/** Existing overwrites + the template's (template wins for the same role/user). */
function merged(ch, templateOw) {
  const ids = new Set(templateOw.map((o) => o.id));
  const kept = [...ch.permissionOverwrites.cache.values()].filter((o) => !ids.has(o.id)).map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }));
  return [...kept, ...templateOw];
}

/** Apply the plan. Returns a report. */
async function apply(guild, opts = {}, onProgress = async () => {}) {
  await guild.channels.fetch();
  await guild.roles.fetch();
  const g = store.guild(guild.id);
  const p = plan(guild, opts);
  const report = { reused: 0, created: 0, hidden: 0, kept: p.keep.length, rolesCreated: 0, rolesReused: p.roleReuse.length, categoriesRemoved: 0, warnings: [] };
  const backup = {
    at: Date.now(),
    channels: {},
    createdChannels: [],
    createdRoles: [],
    deletedCategories: [],
    prevChannels: { ...g.channels },
    prevRoles: { ...g.roles },
  };
  const save = (ch) => {
    if (!backup.channels[ch.id]) backup.channels[ch.id] = snapshot(ch);
  };
  const reason = 'King A /setup2';

  // ---- roles: reuse existing, create missing (existing roles are never edited)
  await onProgress('🎭 Roles…');
  for (const { key, role } of p.roleReuse) g.roles[key] = role.id;
  for (const spec of p.roleCreate) {
    try {
      const r = await guild.roles.create({
        name: spec.name,
        color: spec.color || 0,
        hoist: !!spec.hoist,
        mentionable: spec.key.startsWith('p_') || spec.key === 'welcome_squad',
        permissions: (spec.perms || []).map((x) => P[x]),
        reason,
      });
      g.roles[spec.key] = r.id;
      backup.createdRoles.push(r.id);
      report.rolesCreated++;
    } catch (e) {
      report.warnings.push(`Role ${spec.name}: ${e.message}`);
    }
  }
  store.markDirty();

  // ---- categories
  await onProgress('📁 Categories…');
  const catAccess = (c) => (c.access === 'staff' || c.access?.roles ? c.access : 'public');
  for (const { key, cat, newName } of p.catReuse) {
    const spec = tpl.categories.find((c) => c.key === key);
    save(cat);
    await cat.edit({ name: newName, permissionOverwrites: merged(cat, overwritesFor(guild, g, catAccess(spec), false)), reason }).catch((e) => report.warnings.push(`${cat.name}: ${e.message}`));
    g.channels[key] = cat.id;
  }
  for (const spec of p.catCreate) {
    const cat = await guild.channels.create({ name: spec.name, type: ChannelType.GuildCategory, permissionOverwrites: overwritesFor(guild, g, catAccess(spec), false), reason });
    backup.createdChannels.push(cat.id);
    g.channels[spec.key] = cat.id;
    report.created++;
  }

  // ---- channels: tidy the matched ones, create the missing ones
  await onProgress('✏️ Tidying existing channels…');
  for (const { key, ch, spec, newName } of p.reuse) {
    const access = spec.access || tpl.categories.find((c) => c.key === spec.cat).access || 'public';
    const isVoice = isVoiceType(ch.type);
    const edit = {
      name: newName,
      parent: g.channels[spec.cat],
      lockPermissions: false,
      permissionOverwrites: merged(ch, overwritesFor(guild, g, access, isVoice)),
      reason,
    };
    if (!ch.topic && spec.topic && 'topic' in ch) edit.topic = spec.topic;
    save(ch);
    try {
      await ch.edit(edit);
      report.reused++;
    } catch (e) {
      report.warnings.push(`${ch.name}: ${e.message}`);
    }
    g.channels[key] = ch.id;
  }
  await onProgress('➕ Creating missing channels…');
  for (const { key, spec } of p.create) {
    const type = spec.type ?? ChannelType.GuildText;
    const access = spec.access || tpl.categories.find((c) => c.key === spec.cat).access || 'public';
    const opts2 = { name: spec.name, type, parent: g.channels[spec.cat], permissionOverwrites: overwritesFor(guild, g, access, type === ChannelType.GuildVoice), reason };
    if (type === ChannelType.GuildText) {
      if (spec.topic) opts2.topic = spec.topic;
      if (spec.slowmode) opts2.rateLimitPerUser = spec.slowmode;
    }
    if (type === ChannelType.GuildVoice && spec.limit) opts2.userLimit = spec.limit;
    try {
      const ch = await guild.channels.create(opts2);
      backup.createdChannels.push(ch.id);
      g.channels[key] = ch.id;
      report.created++;
    } catch (e) {
      report.warnings.push(`Create ${spec.name}: ${e.message}`);
    }
  }
  store.markDirty();

  // ---- hide unused channels in the archive
  if (p.hide.length) {
    await onProgress('🗄️ Archiving unused channels…');
    const staffIds = ['admin', 'mod'].map((k) => g.roles[k]).filter(Boolean);
    let archive = p.archived;
    if (!archive) {
      archive = await guild.channels.create({
        name: ARCHIVE_NAME,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
          { id: guild.members.me.id, allow: [P.ViewChannel, P.ManageChannels] },
          ...staffIds.map((id) => ({ id, allow: [P.ViewChannel] })),
        ],
        reason,
      });
      backup.createdChannels.push(archive.id);
    }
    for (const { ch } of p.hide) {
      save(ch);
      try {
        await ch.edit({
          parent: archive.id,
          lockPermissions: false,
          permissionOverwrites: merged(ch, [
            { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
            { id: guild.members.me.id, allow: [P.ViewChannel, P.ManageChannels] },
            ...staffIds.map((id) => ({ id, allow: [P.ViewChannel] })),
          ]),
          reason,
        });
        report.hidden++;
      } catch (e) {
        report.warnings.push(`Hide ${ch.name}: ${e.message}`);
      }
    }
  }

  // ---- remove categories left empty (recreated by undo)
  const templateCatIds = new Set(tpl.categories.map((c) => g.channels[c.key]));
  for (const cat of guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).values()) {
    if (templateCatIds.has(cat.id) || cat.name === ARCHIVE_NAME) continue;
    const kids = guild.channels.cache.filter((c) => c.parentId === cat.id);
    if (kids.size) continue;
    backup.deletedCategories.push({ id: cat.id, ...snapshot(cat) });
    await cat.delete(reason).then(() => report.categoriesRemoved++).catch(() => {});
  }

  // ---- order: template categories first, then anything kept, archive last
  await onProgress('🔢 Ordering…');
  try {
    const order = tpl.categories.map((c) => g.channels[c.key]).filter(Boolean);
    const extras = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory && !order.includes(c.id) && c.name !== ARCHIVE_NAME).sort((a, b) => a.position - b.position).map((c) => c.id);
    const archiveCat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === ARCHIVE_NAME);
    const all = [...order, ...extras, ...(archiveCat ? [archiveCat.id] : [])];
    await guild.channels.setPositions(all.map((id, i) => ({ channel: id, position: i })));
    for (const cat of tpl.categories) {
      const want = cat.channels.map((c) => g.channels[c.key]).filter(Boolean);
      const others = guild.channels.cache.filter((c) => c.parentId === g.channels[cat.key] && !want.includes(c.id)).map((c) => c.id);
      const list = [...want, ...others];
      if (list.length) await guild.channels.setPositions(list.map((id, i) => ({ channel: id, position: i })));
    }
  } catch (e) {
    report.warnings.push(`Ordering: ${e.message}`);
  }

  // ---- additive settings + posts in newly created channels only
  await onProgress('📝 Finishing up…');
  await safeSettings(guild, report);
  const created = new Set(p.create.map((c) => c.key));
  const get = (k) => guild.channels.cache.get(g.channels[k]);
  const post = async (k, payload, pin = false) => {
    const ch = get(k);
    if (!ch?.send) return;
    const m = await ch.send(payload).catch((e) => report.warnings.push(`Post in ${k}: ${e.message}`));
    if (pin && m?.pin) await m.pin().catch(() => {});
  };
  if (created.has('rules')) await post('rules', { embeds: content.rulesEmbeds() });
  if (created.has('about')) await post('about', { embeds: content.aboutEmbeds(guild) });
  if (created.has('self_roles') && get('self_roles')) {
    g.reactionPanels = {};
    await require('../features/reactionroles').postPanels(get('self_roles')).catch((e) => report.warnings.push(`Self-roles: ${e.message}`));
  }
  if (created.has('welcome')) await post('welcome', content.welcomeHeader());
  if (created.has('introductions')) await post('introductions', content.introTemplate(), true);
  if (created.has('games')) await post('games', content.gamesGuide(), true);
  if (created.has('activities')) await post('activities', require('../features/activities').panel(guild.id));
  if (created.has('wordle')) await post('wordle', content.wordleGuide(), true);
  if (created.has('counting')) {
    await post('counting', { content: '🔢 Start counting! The first number is **1**.' });
    g.counting = { current: 0, lastUser: null, best: g.counting?.best || 0 };
  }
  if (created.has('word_chain')) {
    await post('word_chain', { content: '🔤 Word chain starts now. First word: **gear** — next word starts with **r**.' });
    g.wordchain = { lastWord: 'gear', lastUser: null, used: ['gear'] };
  }
  if (created.has('console')) await post('console', require('../commands/safety').consoleWelcome(), true);
  if (created.has('mod_chat')) await post('mod_chat', content.staffGuide(), true);

  g.setup2Backup = backup;
  store.markDirty();
  store.save();
  try {
    require('../features/stats').updateGuild(guild);
  } catch {
    /* ignore */
  }
  return { report, plan: p };
}

/** Put everything back the way it was before the last /setup2. */
async function undo(guild, onProgress = async () => {}) {
  const g = store.guild(guild.id);
  const b = g.setup2Backup;
  if (!b) throw new Error('There\'s no /setup2 to undo.');
  await guild.channels.fetch();
  const report = { restored: 0, deleted: 0, rolesDeleted: 0, warnings: [] };
  const reason = 'King A /setup2 undo';
  const idMap = {};

  await onProgress('📁 Recreating removed categories…');
  for (const c of b.deletedCategories) {
    const cat = await guild.channels.create({ name: c.name, type: ChannelType.GuildCategory, permissionOverwrites: c.overwrites.map((o) => ({ ...o, allow: BigInt(o.allow), deny: BigInt(o.deny) })), reason }).catch(() => null);
    if (cat) idMap[c.id] = cat.id;
  }

  await onProgress('↩️ Restoring channels…');
  for (const [id, snap] of Object.entries(b.channels)) {
    const ch = guild.channels.cache.get(id);
    if (!ch) continue;
    const edit = {
      name: snap.name,
      permissionOverwrites: snap.overwrites.map((o) => ({ ...o, allow: BigInt(o.allow), deny: BigInt(o.deny) })),
      reason,
    };
    if (ch.type !== ChannelType.GuildCategory) {
      edit.parent = snap.parentId ? idMap[snap.parentId] || snap.parentId : null;
      edit.lockPermissions = false;
    }
    if ('topic' in ch && snap.topic !== undefined) edit.topic = snap.topic;
    await ch.edit(edit).then(() => report.restored++).catch((e) => report.warnings.push(`${snap.name}: ${e.message}`));
  }
  try {
    const positions = Object.entries(b.channels)
      .filter(([id]) => guild.channels.cache.has(id))
      .map(([id, s]) => ({ channel: id, position: s.position }));
    if (positions.length) await guild.channels.setPositions(positions);
  } catch (e) {
    report.warnings.push(`Ordering: ${e.message}`);
  }

  await onProgress('🧹 Removing what /setup2 created…');
  const created = b.createdChannels.map((id) => guild.channels.cache.get(id)).filter(Boolean);
  for (const ch of created.filter((c) => c.type !== ChannelType.GuildCategory)) await ch.delete(reason).then(() => report.deleted++).catch(() => {});
  for (const ch of created.filter((c) => c.type === ChannelType.GuildCategory)) {
    if (guild.channels.cache.some((c) => c.parentId === ch.id)) continue; // something else lives there now
    await ch.delete(reason).then(() => report.deleted++).catch(() => {});
  }
  for (const id of b.createdRoles) {
    const r = guild.roles.cache.get(id);
    if (r?.editable) await r.delete(reason).then(() => report.rolesDeleted++).catch(() => {});
  }

  g.channels = b.prevChannels || {};
  g.roles = b.prevRoles || {};
  delete g.setup2Backup;
  store.markDirty();
  store.save();
  return report;
}

/** Plain-text version of the plan for the preview attachment. */
function planText(p) {
  const L = [];
  L.push(`REUSE & TIDY (${p.reuse.length}) — renamed/moved, messages kept`);
  for (const r of p.reuse) L.push(`  ${r.ch.name}  →  ${r.newName}`);
  L.push('', `HIDE IN ARCHIVE (${p.hide.length}) — hidden from members, staff can still see, nothing deleted`);
  for (const h of p.hide) L.push(`  ${h.ch.name}   (${h.why})`);
  L.push('', `KEEP AS IS (${p.keep.length})`);
  for (const k of p.keep) L.push(`  ${k.ch.name}   (${k.why})`);
  L.push('', `CREATE (${p.create.length} channels, ${p.catCreate.length} categories)`);
  for (const c of p.catCreate) L.push(`  [category] ${c.name}`);
  for (const c of p.create) L.push(`  ${c.spec.name}`);
  L.push('', `CATEGORIES REUSED (${p.catReuse.length})`);
  for (const c of p.catReuse) L.push(`  ${c.cat.name}  →  ${c.newName}`);
  L.push('', `ROLES: reuse ${p.roleReuse.length}, create ${p.roleCreate.length} (existing roles are not changed)`);
  for (const r of p.roleReuse) L.push(`  reuse  ${r.role.name}`);
  for (const r of p.roleCreate) L.push(`  create ${r.name}`);
  return L.join('\n');
}

module.exports = { plan, apply, undo, planText, plain, score, ARCHIVE_NAME };
