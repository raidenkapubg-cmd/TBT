// Channel rules (trap channels, media-only, no links…), anti-spam and temporary bans.
const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config');
const store = require('../store');
const { embed, log, isMod, channel } = require('../util/helpers');

const URL_RE = /https?:\/\/\S+|www\.\S+\.\S+/i;
const INVITE_RE = /(discord\.gg|discord(app)?\.com\/invite|dsc\.gg)\/\S+/i;

// ---------------------------------------------------------------- rule catalogue
const RULES = {
  trap: {
    label: '🪤 Trap',
    describe: (r) => `anyone who posts gets **${actionText(r)}** and their recent messages wiped (catches hacked accounts & spam bots)`,
  },
  media_only: { label: '🖼️ Media only', describe: () => 'only images, videos, files or links — text-only messages are deleted' },
  text_only: { label: '📝 Text only', describe: () => 'attachments are deleted' },
  no_links: { label: '🔗 No links', describe: () => 'messages with links are deleted' },
  auto_delete: { label: '⏳ Auto-delete', describe: (r) => `messages delete themselves after ${r.seconds || 60}s` },
  auto_react: { label: '👍 Auto-react', describe: (r) => `every post gets ${(r.emojis || ['👍']).join(' ')}` },
  auto_thread: { label: '🧵 Auto-thread', describe: () => 'every post gets its own discussion thread' },
  no_xp: { label: '🚫 No XP', describe: () => 'messages here don\'t earn XP' },
  one_message: { label: '☝️ One post each', describe: () => 'each member can post once (great for introductions)' },
  min_level: { label: '🔒 Level gate', describe: (r) => `only members level ${r.level || 5}+ can post` },
};

function actionText(r) {
  const a = r.action || 'tempban';
  if (a === 'tempban') return `banned for ${r.days || 7} day${(r.days || 7) === 1 ? '' : 's'}`;
  if (a === 'timeout') return `timed out for ${r.minutes || 60} min`;
  return { softban: 'soft-banned (kicked + messages wiped)', kick: 'kicked', ban: 'permanently banned' }[a] || a;
}

function rulesFor(guildId, channelId) {
  return store.guild(guildId).channelRules[channelId] || [];
}

function setRule(guild, channelId, rule) {
  if (!RULES[rule.rule]) throw new Error(`Unknown rule "${rule.rule}". Rules: ${Object.keys(RULES).join(', ')}`);
  const g = store.guild(guild.id);
  const list = (g.channelRules[channelId] || []).filter((r) => r.rule !== rule.rule);
  list.push(rule);
  g.channelRules[channelId] = list;
  store.markDirty();
  return `${RULES[rule.rule].label}: ${RULES[rule.rule].describe(rule)}`;
}

function clearRules(guild, channelId, ruleName) {
  const g = store.guild(guild.id);
  const before = g.channelRules[channelId] || [];
  g.channelRules[channelId] = ruleName ? before.filter((r) => r.rule !== ruleName) : [];
  if (!g.channelRules[channelId].length) delete g.channelRules[channelId];
  store.markDirty();
  return before.length - (g.channelRules[channelId]?.length || 0);
}

function listRules(guild) {
  const g = store.guild(guild.id);
  const lines = [];
  for (const [chId, list] of Object.entries(g.channelRules)) {
    const ch = guild.channels.cache.get(chId);
    if (!ch) continue;
    for (const r of list) lines.push(`${ch} — ${RULES[r.rule]?.label}: ${RULES[r.rule]?.describe(r)}`);
  }
  return lines;
}

// ---------------------------------------------------------------- punishments
async function rejoinInvite(guild) {
  const g = store.guild(guild.id);
  if (g.rejoinInvite) {
    const ok = await guild.invites.fetch(g.rejoinInvite).catch(() => null);
    if (ok) return `https://discord.gg/${g.rejoinInvite}`;
  }
  const ch = channel(guild, 'rules') || channel(guild, 'welcome') || guild.channels.cache.find((c) => c.isTextBased?.() && c.permissionsFor(guild.roles.everyone)?.has('ViewChannel'));
  if (!ch) return null;
  const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'Rejoin link for temp-banned members' }).catch(() => null);
  if (!inv) return null;
  g.rejoinInvite = inv.code;
  store.markDirty();
  return inv.url;
}

/** Ban for N days, wipe recent messages, DM them a rejoin link first. */
async function tempban(member, { days = 7, reason = 'No reason', deleteDays = 1, by = 'King A', hacked = false } = {}) {
  const guild = member.guild;
  const invite = await rejoinInvite(guild);
  const until = Date.now() + days * 86400000;
  await member
    .send(
      [
        `⛔ You've been temporarily banned from **${guild.name}** for **${days} day${days === 1 ? '' : 's'}**.`,
        `Reason: ${reason}`,
        hacked ? '\n🔐 This often happens when an account gets hacked and posts spam. **Change your password and turn on 2FA** right away.' : '',
        invite ? `\nYou can rejoin <t:${Math.floor(until / 1000)}:R> with this link: ${invite}` : '',
      ].filter(Boolean).join('\n'),
    )
    .catch(() => {});
  await member.ban({ reason: `[tempban ${days}d] ${reason} — by ${by}`, deleteMessageSeconds: Math.min(7, deleteDays) * 86400 });
  const g = store.guild(guild.id);
  g.tempBans[member.id] = { until, reason, tag: member.user.tag };
  store.markDirty();
  return `⏳ Banned **${member.user.tag}** for ${days} day${days === 1 ? '' : 's'} (auto-unban <t:${Math.floor(until / 1000)}:R>)`;
}

async function softban(member, { reason = 'No reason', by = 'King A' } = {}) {
  const invite = await rejoinInvite(member.guild);
  await member.send(`👢 You were removed from **${member.guild.name}** and your recent messages were cleared. Reason: ${reason}${invite ? `\nYou can rejoin any time: ${invite}` : ''}`).catch(() => {});
  await member.ban({ reason: `[softban] ${reason} — by ${by}`, deleteMessageSeconds: 86400 });
  await member.guild.members.unban(member.id, 'softban').catch(() => {});
  return `🧹 Soft-banned **${member.user.tag}** (kicked + last 24h of messages wiped, can rejoin)`;
}

async function punish(member, r, reason) {
  const a = r.action || 'tempban';
  if (a === 'tempban') return tempban(member, { days: r.days || 7, reason, deleteDays: 1, hacked: true });
  if (a === 'softban') return softban(member, { reason });
  if (a === 'kick') {
    await member.kick(reason);
    return `👢 Kicked **${member.user.tag}**`;
  }
  if (a === 'ban') {
    await member.ban({ reason, deleteMessageSeconds: 86400 });
    return `🔨 Banned **${member.user.tag}**`;
  }
  if (a === 'timeout') {
    await member.timeout((r.minutes || 60) * 60000, reason);
    return `🔇 Timed out **${member.user.tag}** for ${r.minutes || 60} min`;
  }
  return null;
}

// ---------------------------------------------------------------- channel rules engine
async function applyRules(msg) {
  const list = rulesFor(msg.guild.id, msg.channel.id);
  if (!list.length) return false;
  const staff = isMod(msg.member);
  const hasMedia = msg.attachments.size > 0 || URL_RE.test(msg.content) || msg.stickers.size > 0;

  for (const r of list) {
    if (r.rule === 'trap') {
      if (staff) {
        await msg.react('🛡️').catch(() => {});
        continue; // staff are immune so you can test/post warnings
      }
      const reason = `Posted in trap channel #${msg.channel.name}`;
      await msg.delete().catch(() => {});
      try {
        const result = await punish(msg.member, r, reason);
        await log(msg.guild, 'server_logs', { embeds: [embed(config.color.bad).setTitle('🪤 Trap triggered').setDescription(`${result}\nIn ${msg.channel}\n> ${(msg.content || '[attachment]').slice(0, 500)}`)] });
      } catch (err) {
        await log(msg.guild, 'server_logs', { content: `🪤 Trap in ${msg.channel} caught ${msg.author.tag} but I couldn't punish them: ${err.message}` });
      }
      return true;
    }
    if (staff && ['media_only', 'text_only', 'no_links', 'one_message', 'min_level'].includes(r.rule)) continue;
    const remove = async (why) => {
      await msg.delete().catch(() => {});
      const warn = await msg.channel.send(`<@${msg.author.id}> ${why}`).catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => {}), 6000).unref();
      return true;
    };
    if (r.rule === 'media_only' && !hasMedia) return remove('this channel is **media only** — post an image, video or link. 🖼️');
    if (r.rule === 'text_only' && msg.attachments.size) return remove('this channel is **text only**. 📝');
    if (r.rule === 'no_links' && URL_RE.test(msg.content)) return remove('**no links** in this channel. 🔗');
    if (r.rule === 'min_level') {
      const lvl = store.user(msg.guild.id, msg.author.id).level;
      if (lvl < (r.level || 5)) return remove(`you need **level ${r.level || 5}** to post here (you're ${lvl}). Keep chatting! 📈`);
    }
    if (r.rule === 'one_message') {
      if (!r.posted || Array.isArray(r.posted)) r.posted = {};
      if (r.posted[msg.author.id]) return remove('you already posted here — **one post each**. Edit your old one instead! ✏️');
      r.posted[msg.author.id] = msg.id;
      store.markDirty();
    }
  }
  for (const r of list) {
    if (r.rule === 'auto_react') for (const e of r.emojis || ['👍']) await msg.react(e).catch(() => {});
    if (r.rule === 'auto_thread') await msg.startThread({ name: (r.name || `${msg.member.displayName}'s thread`).slice(0, 90), autoArchiveDuration: 1440 }).catch(() => {});
    if (r.rule === 'auto_delete') setTimeout(() => msg.delete().catch(() => {}), (r.seconds || 60) * 1000).unref();
  }
  return false;
}

// ---------------------------------------------------------------- anti-spam
const history = new Map(); // `${guildId}:${userId}` -> [{ ts, channelId, msg, norm }]
const handled = new Set();

async function antiSpam(msg) {
  const g = store.guild(msg.guild.id);
  if (!g.antispam.enabled || isMod(msg.member)) return false;

  // Invite links
  if (g.antispam.blockInvites && INVITE_RE.test(msg.content)) {
    await msg.delete().catch(() => {});
    const w = await msg.channel.send(`<@${msg.author.id}> no server invites here, please. 🚫`).catch(() => null);
    if (w) setTimeout(() => w.delete().catch(() => {}), 6000).unref();
    await log(msg.guild, 'message_logs', { content: `🚫 Deleted invite from ${msg.author.tag} in ${msg.channel}: ${msg.content.slice(0, 300)}` });
    return true;
  }

  const key = `${msg.guild.id}:${msg.author.id}`;
  const now = Date.now();
  const norm = msg.content.toLowerCase().replace(/\s+/g, ' ').trim();
  const list = (history.get(key) || []).filter((h) => now - h.ts < 60000);
  list.push({ ts: now, channelId: msg.channel.id, msg, norm });
  history.set(key, list);
  if (history.size > 5000) history.delete(history.keys().next().value);
  if (handled.has(key)) return true;

  const wipe = async (items) => {
    const byChannel = new Map();
    for (const h of items) byChannel.set(h.channelId, [...(byChannel.get(h.channelId) || []), h.msg]);
    for (const [, msgs] of byChannel) {
      const ch = msgs[0].channel;
      await ch.bulkDelete(msgs, true).catch(() => Promise.all(msgs.map((m) => m.delete().catch(() => {}))));
    }
  };
  const flag = () => {
    handled.add(key);
    setTimeout(() => handled.delete(key), 30000).unref();
  };

  // Same message (with a link, or long) in 3+ channels within a minute = classic hacked-account spam
  if (norm.length >= 8) {
    const same = list.filter((h) => h.norm === norm);
    const channels = new Set(same.map((h) => h.channelId));
    if (channels.size >= 3 || (same.length >= 4 && URL_RE.test(msg.content))) {
      flag();
      await wipe(same);
      await msg.member.timeout(24 * 3600000, 'Possible compromised account: same message spammed across channels').catch(() => {});
      await reportCard(msg.guild, {
        title: '🚨 Possible hacked account',
        target: msg.member,
        text: `Posted the same message in ${channels.size} channels within a minute. I deleted it and timed them out for 24h.\n> ${msg.content.slice(0, 400)}`,
        by: 'King A anti-spam',
      });
      return true;
    }
  }

  // Flooding: 7+ messages in 5 seconds
  const burst = list.filter((h) => now - h.ts < 5000);
  if (burst.length >= 7) {
    flag();
    await wipe(burst);
    await msg.member.timeout(5 * 60000, 'Message flooding').catch(() => {});
    await msg.channel.send(`🌊 <@${msg.author.id}> slow down! Timed out for 5 minutes for flooding.`).catch(() => {});
    await log(msg.guild, 'server_logs', { content: `🌊 Flood: timed out ${msg.author.tag} for 5 min in ${msg.channel}` });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- reports (shared with /report)
async function reportCard(guild, { title, target, text, by, messageUrl }) {
  const ch = channel(guild, 'reports') || channel(guild, 'mod_chat');
  if (!ch) return;
  const g = store.guild(guild.id);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  g.reports[id] = { targetId: target.id, at: Date.now() };
  store.markDirty();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rep:timeout:${id}`).setLabel('Timeout 1h').setEmoji('🔇').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rep:untimeout:${id}`).setLabel('Release').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rep:kick:${id}`).setLabel('Kick').setEmoji('👢').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`rep:tempban:${id}`).setLabel('Ban 7d').setEmoji('⏳').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`rep:dismiss:${id}`).setLabel('Dismiss').setEmoji('✅').setStyle(ButtonStyle.Success),
  );
  const e = embed(config.color.bad)
    .setTitle(title)
    .setAuthor({ name: `${target.user.tag} (${target.id})`, iconURL: target.displayAvatarURL() })
    .setDescription(`${text}${messageUrl ? `\n[Jump to message](${messageUrl})` : ''}`)
    .addFields({ name: 'Account age', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true }, { name: 'Reported by', value: by, inline: true })
    .setTimestamp();
  await ch.send({ embeds: [e], components: [row] }).catch(() => {});
}

async function onReportButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (!isMod(interaction.member)) return interaction.reply({ content: 'Staff only.', flags: MessageFlags.Ephemeral });
  const rep = store.guild(interaction.guild.id).reports[id];
  if (!rep) return interaction.reply({ content: 'This report expired.', flags: MessageFlags.Ephemeral });
  const member = await interaction.guild.members.fetch(rep.targetId).catch(() => null);
  let result;
  try {
    if (action === 'dismiss') result = '✅ Dismissed';
    else if (!member) result = '👻 They already left the server.';
    else if (action === 'timeout') {
      await member.timeout(3600000, `Report — by ${interaction.user.tag}`);
      result = `🔇 Timed out ${member.user.tag} for 1h`;
    } else if (action === 'untimeout') {
      await member.timeout(null);
      result = `🔊 Released ${member.user.tag}`;
    } else if (action === 'kick') {
      await member.kick(`Report — by ${interaction.user.tag}`);
      result = `👢 Kicked ${member.user.tag}`;
    } else if (action === 'tempban') {
      result = await tempban(member, { days: 7, reason: 'Reported to staff', by: interaction.user.tag });
    }
  } catch (err) {
    result = `❌ ${err.message}`;
  }
  const final = !['timeout', 'untimeout'].includes(action) || result.startsWith('❌');
  const e = interaction.message.embeds[0] ? [require('discord.js').EmbedBuilder.from(interaction.message.embeds[0]).setFooter({ text: `${result} — ${interaction.user.tag}` }).setColor(final ? 0x99aab5 : config.color.warn)] : [];
  await interaction.update({ embeds: e, components: final ? [] : interaction.message.components });
  if (final) delete store.guild(interaction.guild.id).reports[id];
  store.markDirty();
}

// ---------------------------------------------------------------- init
function init(client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot || !msg.member) return;
    try {
      if (await applyRules(msg)) return;
      await antiSpam(msg);
    } catch (err) {
      console.error('[guard]', err.message);
    }
  });

  // Lift expired temp bans every minute
  const sweep = async () => {
    for (const guild of client.guilds.cache.values()) {
      const g = store.guild(guild.id);
      for (const [userId, tb] of Object.entries(g.tempBans)) {
        if (tb.until > Date.now()) continue;
        await guild.members.unban(userId, 'Temp ban expired').catch(() => {});
        delete g.tempBans[userId];
        store.markDirty();
        await log(guild, 'server_logs', { content: `🕊️ Temp ban expired — unbanned **${tb.tag || userId}**` });
      }
    }
  };
  client.once(Events.ClientReady, () => {
    sweep();
    setInterval(sweep, 60000);
  });

  // Let one_message work again when someone deletes their post
  client.on(Events.MessageDelete, (msg) => {
    if (!msg.guild || !msg.author) return;
    for (const r of rulesFor(msg.guild.id, msg.channel.id)) {
      // Only free the slot if their recorded post was the one deleted
      if (r.rule === 'one_message' && r.posted && r.posted[msg.author.id] === msg.id) {
        delete r.posted[msg.author.id];
        store.markDirty();
      }
    }
  });
}

module.exports = { init, RULES, setRule, clearRules, listRules, tempban, softban, reportCard, components: { rep: onReportButton }, actionText };
