// Text reports staff can ask the console for.
const { ChannelType } = require('discord.js');
const store = require('../store');

async function build(guild, a = {}) {
  const kind = String(a.kind || 'server').toLowerCase();
  const g = store.guild(guild.id);
  const users = Object.entries(g.users);

  if (kind.startsWith('member') || kind.startsWith('user')) {
    const { resolveMember } = require('./actions');
    const m = await resolveMember(guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    const u = store.user(guild.id, m.id);
    const warns = u.warns || [];
    return [
      `📋 **${m.user.tag}** (${m.id})`,
      `Joined <t:${Math.floor((m.joinedTimestamp || 0) / 1000)}:R> · account created <t:${Math.floor(m.user.createdTimestamp / 1000)}:R>`,
      `Level ${u.level} · ${u.xp} XP · ${u.messages} messages · 🪙 ${u.coins}`,
      `Roles: ${m.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.name).join(', ') || 'none'}`,
      `Warnings: ${warns.length}${warns.length ? `\n${warns.slice(-5).map((w) => `• ${w.reason} (<t:${Math.floor(w.at / 1000)}:R>)`).join('\n')}` : ''}`,
      m.communicationDisabledUntilTimestamp > Date.now() ? `🔇 Timed out until <t:${Math.floor(m.communicationDisabledUntilTimestamp / 1000)}:f>` : '',
    ].filter(Boolean).join('\n');
  }

  if (kind.startsWith('warn')) {
    const rows = users.filter(([, u]) => u.warns?.length).sort((x, y) => y[1].warns.length - x[1].warns.length).slice(0, 15);
    return rows.length ? `⚠️ **Most warned**\n${rows.map(([id, u]) => `<@${id}> — ${u.warns.length} (latest: ${u.warns[u.warns.length - 1].reason})`).join('\n')}` : '⚠️ No warnings on record.';
  }

  if (kind.startsWith('ban') || kind.startsWith('temp')) {
    const temp = Object.entries(g.tempBans);
    const bans = await guild.bans.fetch().catch(() => null);
    return [
      `⏳ **Temp bans (${temp.length})**`,
      ...temp.map(([id, t]) => `${t.tag || id} — lifts <t:${Math.floor(t.until / 1000)}:R> — ${t.reason}`),
      `\n🔨 **All bans:** ${bans ? bans.size : '?'}`,
      ...(bans ? [...bans.values()].slice(0, 10).map((b) => `${b.user.tag} — ${b.reason || 'no reason'}`) : []),
    ].join('\n');
  }

  if (kind.startsWith('rule') || kind.startsWith('channel')) {
    const lines = require('./guard').listRules(guild);
    return lines.length ? `📏 **Channel rules**\n${lines.join('\n')}\n\nAnti-spam: ${g.antispam.enabled ? 'ON' : 'OFF'} · invite blocking: ${g.antispam.blockInvites ? 'ON' : 'OFF'}` : `📏 No channel rules set. Anti-spam: ${g.antispam.enabled ? 'ON' : 'OFF'}`;
  }

  if (kind.startsWith('level') || kind.startsWith('xp') || kind.startsWith('top') || kind.startsWith('activ')) {
    const ladder = require('./levels').ladder(guild);
    const top = users.sort((x, y) => y[1].xp - x[1].xp).slice(0, 10);
    return [
      '🪜 **Level roles**',
      ladder.map((s) => `Lvl ${s.level} → ${guild.roles.cache.get(s.roleId)?.name}`).join('\n') || 'none',
      '\n🏆 **Top members**',
      top.map(([id, u], n) => `${n + 1}. <@${id}> — lvl ${u.level} (${u.messages} msgs)`).join('\n') || 'nobody yet',
    ].join('\n');
  }

  // server overview
  const members = guild.members.cache;
  const bots = members.filter((m) => m.user.bot).size;
  const weekAgo = Date.now() - 7 * 86400000;
  const newThisWeek = members.filter((m) => (m.joinedTimestamp || 0) > weekAgo).size;
  const chans = guild.channels.cache;
  return [
    `📊 **${guild.name}**`,
    `👥 ${guild.memberCount} members (${bots} bots) · 🆕 ${newThisWeek} joined this week`,
    `📁 ${chans.filter((c) => c.type === ChannelType.GuildCategory).size} categories · ${chans.filter((c) => c.type === ChannelType.GuildText).size} text · ${chans.filter((c) => c.type === ChannelType.GuildVoice).size} voice`,
    `🎭 ${guild.roles.cache.size} roles · 🚀 ${guild.premiumSubscriptionCount || 0} boosts`,
    `📈 ${users.length} members have talked · ${users.filter(([, u]) => u.level >= 5).length} at level 5+`,
    `⏳ ${Object.keys(g.tempBans).length} temp bans active · 📏 ${Object.keys(g.channelRules).length} channels with rules`,
    `🔥 Banter ${g.banter.paused ? 'paused' : 'on'} · 🛡️ anti-spam ${g.antispam.enabled ? 'on' : 'off'}`,
  ].join('\n');
}

module.exports = { build };
