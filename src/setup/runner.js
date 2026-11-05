// Builds the whole server from the template.
const { ChannelType, PermissionFlagsBits, GuildVerificationLevel, GuildExplicitContentFilter,
  GuildDefaultMessageNotifications, AutoModerationRuleTriggerType, AutoModerationRuleKeywordPresetType,
  AutoModerationActionType, AutoModerationRuleEventType } = require('discord.js');
const store = require('../store');
const tpl = require('./template');
const content = require('./content');
const { sleep } = require('../util/helpers');

const P = PermissionFlagsBits;

function allRoleSpecs() {
  const specs = [...tpl.roles];
  for (const cat of tpl.selfRoleCategories) {
    for (const o of cat.options) specs.push({ key: o.key, name: o.name, color: 0, hoist: false, selfRole: true });
  }
  return specs;
}

async function ensureRoles(guild, g, report) {
  const me = guild.members.me;
  // Clean up level roles from older versions (replaced by the lvl_* ladder)
  for (const legacy of ['rookie', 'regular', 'legend']) {
    const id = g.roles[legacy];
    if (!id) continue;
    delete g.roles[legacy];
    const old = guild.roles.cache.get(id);
    const reused = tpl.roles.some((r) => r.name === old?.name);
    if (old && !reused && old.editable) await old.delete('Replaced by new level roles').catch(() => {});
  }
  const specs = allRoleSpecs();
  const created = [];
  for (const spec of specs) {
    let role = g.roles[spec.key] && guild.roles.cache.get(g.roles[spec.key]);
    if (!role) role = guild.roles.cache.find((r) => r.name === spec.name);
    const perms = (spec.perms || []).map((p) => P[p]);
    if (!role) {
      role = await guild.roles.create({
        name: spec.name,
        color: spec.color || 0,
        hoist: !!spec.hoist,
        mentionable: spec.key.startsWith('p_') || spec.key === 'welcome_squad',
        permissions: perms,
        reason: 'King A /setup',
      });
      report.rolesCreated++;
    } else if (role.editable) {
      await role.edit({ color: spec.color || 0, hoist: !!spec.hoist, permissions: perms }).catch(() => {});
    }
    g.roles[spec.key] = role.id;
    created.push(role);
  }

  // Put roles in template order directly below the bot's highest role.
  await guild.roles.fetch().catch(() => {});
  const top = me.roles.highest.position;
  const above = guild.roles.cache.filter((r) => r.position > top && !r.managed);
  if (above.size) {
    report.warnings.push(
      `These roles are above mine, so I can't manage them: ${above.map((r) => r.name).join(', ')}. Drag the "King A" role to the top in Server Settings → Roles, then run /setup mode:Add.`,
    );
  }
  const positions = created
    .filter((r) => r.editable)
    .map((r, i) => ({ role: r.id, position: Math.max(1, top - 1 - i) }));
  await guild.roles.setPositions(positions).catch((e) => report.warnings.push(`Role order: ${e.message}`));
  store.markDirty();
}

function overwritesFor(guild, g, access, isVoice) {
  const everyone = guild.roles.everyone.id;
  const me = guild.members.me.id;
  const staffIds = ['admin', 'mod', 'team', 'helper'].map((k) => g.roles[k]).filter(Boolean);
  const ow = [{ id: me, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.ManageMessages, P.Connect, P.EmbedLinks, P.AttachFiles] }];

  if (access === 'readonly') {
    ow.push({ id: everyone, allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions], deny: [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads] });
    for (const id of staffIds) ow.push({ id, allow: [P.SendMessages] });
  } else if (access === 'staff') {
    ow.push({ id: everyone, deny: [P.ViewChannel] });
    for (const id of staffIds) ow.push({ id, allow: [P.ViewChannel, P.SendMessages, P.Connect] });
  } else if (access === 'stat') {
    ow.push({ id: everyone, allow: [P.ViewChannel], deny: [P.Connect] });
  } else if (access && access.roles) {
    ow.push({ id: everyone, deny: [P.ViewChannel] });
    for (const k of access.roles) if (g.roles[k]) ow.push({ id: g.roles[k], allow: [P.ViewChannel, P.SendMessages, P.Connect, P.Speak] });
    for (const id of staffIds) ow.push({ id, allow: [P.ViewChannel, P.SendMessages, P.Connect] });
  } else {
    ow.push({ id: everyone, allow: [P.ViewChannel] });
  }
  if (isVoice && access !== 'stat') ow.forEach((o) => o.id === everyone && !o.deny?.includes(P.ViewChannel) && (o.allow = [...(o.allow || []), P.Connect, P.Speak]));
  return ow;
}

async function ensureChannels(guild, g, report) {
  const keep = new Set();
  let catPos = 0;
  for (const cat of tpl.categories) {
    let category = g.channels[cat.key] && guild.channels.cache.get(g.channels[cat.key]);
    if (!category) category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === cat.name);
    const catOw = overwritesFor(guild, g, cat.access === 'staff' || cat.access?.roles ? cat.access : 'public', false);
    if (!category) {
      category = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, permissionOverwrites: catOw, position: catPos });
      report.channelsCreated++;
    } else {
      await category.edit({ permissionOverwrites: catOw, position: catPos }).catch(() => {});
    }
    catPos++;
    g.channels[cat.key] = category.id;
    keep.add(category.id);

    let pos = 0;
    for (const ch of cat.channels) {
      const type = ch.type ?? ChannelType.GuildText;
      const access = ch.access || cat.access || 'public';
      const permissionOverwrites = overwritesFor(guild, g, access, type === ChannelType.GuildVoice);
      let channel = g.channels[ch.key] && guild.channels.cache.get(g.channels[ch.key]);
      if (!channel) channel = guild.channels.cache.find((c) => c.parentId === category.id && c.name === ch.name);
      const opts = {
        name: ch.name,
        type,
        parent: category.id,
        permissionOverwrites,
        position: pos++,
      };
      if (type === ChannelType.GuildText) {
        if (ch.topic) opts.topic = ch.topic;
        if (ch.slowmode) opts.rateLimitPerUser = ch.slowmode;
      }
      if (type === ChannelType.GuildVoice && ch.limit) opts.userLimit = ch.limit;
      if (!channel) {
        channel = await guild.channels.create(opts);
        report.channelsCreated++;
      } else {
        const { type: _t, ...edit } = opts;
        await channel.edit(edit).catch(() => {});
      }
      g.channels[ch.key] = channel.id;
      keep.add(channel.id);
    }
    store.markDirty();
  }
  return keep;
}

async function wipeExtras(guild, g, keep, report) {
  // Delete channels that aren't part of the template (fresh mode only).
  for (const ch of guild.channels.cache.values()) {
    if (keep.has(ch.id)) continue;
    if (ch.type === ChannelType.GuildCategory) continue;
    if (!ch.deletable) continue;
    await ch.delete('King A /setup (fresh)').then(() => report.channelsDeleted++).catch(() => {});
  }
  for (const ch of guild.channels.cache.values()) {
    if (keep.has(ch.id) || ch.type !== ChannelType.GuildCategory || !ch.deletable) continue;
    await ch.delete('King A /setup (fresh)').then(() => report.channelsDeleted++).catch(() => {});
  }
  const keepRoles = new Set(Object.values(g.roles));
  for (const role of guild.roles.cache.values()) {
    if (role.managed || role.id === guild.id || keepRoles.has(role.id) || !role.editable) continue;
    await role.delete('King A /setup (fresh)').then(() => report.rolesDeleted++).catch(() => {});
  }
}

async function guildSettings(guild, g, report) {
  const afk = guild.channels.cache.get(g.channels.afk);
  await guild
    .edit({
      verificationLevel: GuildVerificationLevel.Medium,
      explicitContentFilter: GuildExplicitContentFilter.AllMembers,
      defaultMessageNotifications: GuildDefaultMessageNotifications.OnlyMentions,
      afkChannel: afk?.id ?? null,
      afkTimeout: 900,
      systemChannel: null,
    })
    .catch((e) => report.warnings.push(`Server settings: ${e.message}`));

  // Official Discord games (Wordle, Putt Party…) need these on @everyone
  try {
    const ev = guild.roles.everyone;
    const need = [P.UseEmbeddedActivities, P.UseApplicationCommands, P.UseExternalApps].filter(Boolean);
    if (need.some((p) => !ev.permissions.has(p))) await ev.setPermissions(ev.permissions.add(need), 'Allow Discord Activities & apps');
  } catch (e) {
    report.warnings.push(`Activity permissions: ${e.message}`);
  }

  // AutoMod: block slurs / sexual content using Discord's built-in word lists.
  try {
    const rules = await guild.autoModerationRules.fetch();
    if (!rules.find((r) => r.name === 'King A - keyword filter')) {
      await guild.autoModerationRules.create({
        name: 'King A - keyword filter',
        eventType: AutoModerationRuleEventType.MessageSend,
        triggerType: AutoModerationRuleTriggerType.KeywordPreset,
        triggerMetadata: {
          presets: [AutoModerationRuleKeywordPresetType.Slurs, AutoModerationRuleKeywordPresetType.SexualContent],
        },
        actions: [{ type: AutoModerationActionType.BlockMessage }],
        enabled: true,
      });
    }
    if (!rules.find((r) => r.name === 'King A - spam filter')) {
      await guild.autoModerationRules.create({
        name: 'King A - spam filter',
        eventType: AutoModerationRuleEventType.MessageSend,
        triggerType: AutoModerationRuleTriggerType.MentionSpam,
        triggerMetadata: { mentionTotalLimit: 6 },
        actions: [{ type: AutoModerationActionType.BlockMessage }],
        enabled: true,
      });
    }
  } catch (e) {
    report.warnings.push(`AutoMod: ${e.message}`);
  }
}

async function postContent(guild, g, report) {
  const get = (k) => guild.channels.cache.get(g.channels[k]);
  const post = async (k, payload, pin = false) => {
    const ch = get(k);
    if (!ch) return null;
    try {
      const msg = await ch.send(payload);
      if (pin) await msg.pin().catch(() => {});
      return msg;
    } catch (e) {
      report.warnings.push(`Post in ${k}: ${e.message}`);
      return null;
    }
  };

  const clearBot = async (k) => {
    const ch = get(k);
    if (!ch) return;
    const msgs = await ch.messages.fetch({ limit: 50 }).catch(() => null);
    if (!msgs) return;
    for (const m of msgs.values()) if (m.author.id === guild.members.me.id) await m.delete().catch(() => {});
  };

  for (const k of ['rules', 'about', 'self_roles', 'welcome']) await clearBot(k);

  await post('rules', { embeds: content.rulesEmbeds() });
  await post('about', { embeds: content.aboutEmbeds(guild) });
  const selfRoles = get('self_roles');
  if (selfRoles) {
    g.reactionPanels = {};
    await require('../features/reactionroles')
      .postPanels(selfRoles)
      .catch((e) => report.warnings.push(`Self-roles: ${e.message}`));
  }
  await post('welcome', content.welcomeHeader());
  await post('introductions', content.introTemplate(), true);
  await post('lfg_unrated', content.lfgGuide('Valorant unrated'), true);
  await post('lfg_ranked', content.lfgGuide('Valorant ranked'), true);
  await post('lfg', content.lfgGuide('any game'), true);
  await post('games', content.gamesGuide(), true);
  await post('activities', require('../features/activities').panel(guild.id));
  await post('wordle', content.wordleGuide(), true);
  await post('counting', { content: '🔢 Start counting! The first number is **1**.' });
  await post('word_chain', { content: '🔤 Word chain starts now. First word: **gear** — next word starts with **r**.' });
  await post('mod_chat', content.staffGuide(), true);
  if (!(await get('console')?.messages.fetch({ limit: 5 }).catch(() => null))?.some((m) => m.author.id === guild.members.me.id)) {
    await post('console', require('../commands/safety').consoleWelcome(), true);
  }

  g.counting = { current: 0, lastUser: null, best: g.counting?.best || 0 };
  g.wordchain = { lastWord: 'gear', lastUser: null, used: ['gear'] };
  store.markDirty();
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {{fresh:boolean, onProgress:(s:string)=>Promise<void>}} opts
 */
async function runSetup(guild, { fresh, onProgress = async () => {} }) {
  const g = store.guild(guild.id);
  const report = { rolesCreated: 0, channelsCreated: 0, channelsDeleted: 0, rolesDeleted: 0, warnings: [] };
  await guild.channels.fetch();
  await guild.roles.fetch();

  if (fresh) {
    g.channels = {};
    g.roles = {};
  }

  await onProgress('🎭 Creating roles…');
  await ensureRoles(guild, g, report);
  // Channels from older versions that were replaced
  for (const legacy of ['fishing']) {
    const ch = g.channels[legacy] && guild.channels.cache.get(g.channels[legacy]);
    if (ch?.deletable) await ch.delete('Replaced in a newer King A version').catch(() => {});
    delete g.channels[legacy];
  }
  await onProgress('🏗️ Building categories and channels…');
  const keep = await ensureChannels(guild, g, report);
  if (fresh) {
    await onProgress('🧹 Clearing out old channels and roles…');
    await wipeExtras(guild, g, keep, report);
  }
  await onProgress('⚙️ Server settings & AutoMod…');
  await guildSettings(guild, g, report);
  await onProgress('📝 Posting rules, self-roles and guides…');
  await postContent(guild, g, report);
  await sleep(500);

  // Kick the stats updater straight away.
  try {
    require('../features/stats').updateGuild(guild);
  } catch {
    /* ignore */
  }
  store.save();
  return report;
}

module.exports = { runSetup };
