const { Events, AuditLogEvent } = require('discord.js');
const config = require('../config');
const { embed, log } = require('../util/helpers');

const ts = (d) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:R>`;
const cut = (s, n = 1000) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '*empty*');

function init(client) {
  client.on(Events.MessageDelete, async (msg) => {
    if (!msg.guild || msg.author?.bot) return;
    await log(msg.guild, 'message_logs', {
      embeds: [
        embed(config.color.bad)
          .setAuthor({ name: msg.author?.tag || 'Unknown', iconURL: msg.author?.displayAvatarURL() })
          .setTitle('🗑️ Message deleted')
          .setDescription(cut(msg.content))
          .addFields({ name: 'Channel', value: `${msg.channel}`, inline: true }, { name: 'Sent', value: ts(msg.createdAt), inline: true })
          .setFooter({ text: `User ID ${msg.author?.id || '?'}` }),
      ],
    });
  });

  client.on(Events.MessageBulkDelete, async (msgs, ch) => {
    if (!ch.guild) return;
    await log(ch.guild, 'message_logs', {
      embeds: [embed(config.color.bad).setTitle('🧹 Bulk delete').setDescription(`${msgs.size} messages deleted in ${ch}`)],
    });
  });

  client.on(Events.MessageUpdate, async (before, after) => {
    if (!after.guild || after.author?.bot || before.content === after.content || !before.content) return;
    await log(after.guild, 'message_logs', {
      embeds: [
        embed(config.color.warn)
          .setAuthor({ name: after.author.tag, iconURL: after.author.displayAvatarURL() })
          .setTitle('✏️ Message edited')
          .setURL(after.url)
          .addFields({ name: 'Before', value: cut(before.content) }, { name: 'After', value: cut(after.content) }, { name: 'Channel', value: `${after.channel}` }),
      ],
    });
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const roles = member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => r.name).join(', ');
    await log(member.guild, 'leave_logs', {
      embeds: [
        embed(0x99aab5)
          .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
          .setTitle('🚪 Member left')
          .addFields(
            { name: 'Joined', value: member.joinedAt ? ts(member.joinedAt) : 'unknown', inline: true },
            { name: 'Account created', value: ts(member.user.createdAt), inline: true },
            { name: 'Members now', value: `${member.guild.memberCount}`, inline: true },
            { name: 'Roles', value: cut(roles || 'none', 1000) },
          )
          .setFooter({ text: `User ID ${member.id}` }),
      ],
    });
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    const ageDays = (Date.now() - member.user.createdTimestamp) / 86400000;
    await log(member.guild, 'server_logs', {
      embeds: [
        embed(config.color.good)
          .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
          .setTitle('📥 Member joined')
          .setDescription(ageDays < 30 ? `⚠️ New account — created ${ts(member.user.createdAt)}` : `Account created ${ts(member.user.createdAt)}`)
          .setFooter({ text: `User ID ${member.id}` }),
      ],
    });
  });

  client.on(Events.GuildMemberUpdate, async (before, after) => {
    const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
    const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
    const lines = [];
    if (added.size) lines.push(`➕ ${added.map((r) => r.name).join(', ')}`);
    if (removed.size) lines.push(`➖ ${removed.map((r) => r.name).join(', ')}`);
    if (before.nickname !== after.nickname) lines.push(`🏷️ Nickname: ${before.nickname || '*none*'} → ${after.nickname || '*none*'}`);
    if (before.communicationDisabledUntilTimestamp !== after.communicationDisabledUntilTimestamp && after.communicationDisabledUntil) {
      lines.push(`🔇 Timed out until ${ts(after.communicationDisabledUntil)}`);
    }
    if (!lines.length) return;
    await log(after.guild, 'server_logs', {
      embeds: [embed(config.color.info).setAuthor({ name: after.user.tag, iconURL: after.user.displayAvatarURL() }).setDescription(lines.join('\n'))],
    });
  });

  const simple = (event, title, color, describe) =>
    client.on(event, async (thing) => {
      const guild = thing.guild;
      if (!guild) return;
      await log(guild, 'server_logs', { embeds: [embed(color).setTitle(title).setDescription(describe(thing))] });
    });

  simple(Events.ChannelCreate, '📁 Channel created', config.color.good, (c) => `${c} (\`${c.name}\`)`);
  simple(Events.ChannelDelete, '🗑️ Channel deleted', config.color.bad, (c) => `\`${c.name}\``);
  simple(Events.GuildRoleCreate, '🎭 Role created', config.color.good, (r) => `${r.name}`);
  simple(Events.GuildRoleDelete, '🗑️ Role deleted', config.color.bad, (r) => `${r.name}`);

  client.on(Events.GuildBanAdd, async (ban) => {
    let by = '';
    try {
      const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
      const entry = logs.entries.first();
      if (entry && entry.target?.id === ban.user.id) by = ` by ${entry.executor?.tag}`;
    } catch {
      /* ignore */
    }
    await log(ban.guild, 'server_logs', {
      embeds: [embed(config.color.bad).setTitle('🔨 Member banned').setDescription(`${ban.user.tag}${by}${ban.reason ? `\nReason: ${ban.reason}` : ''}`)],
    });
  });
  client.on(Events.GuildBanRemove, async (ban) => {
    await log(ban.guild, 'server_logs', { embeds: [embed(config.color.good).setTitle('🕊️ Member unbanned').setDescription(ban.user.tag)] });
  });
}

module.exports = { init };
