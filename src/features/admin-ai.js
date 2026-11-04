// Plain-English server control for staff: "@King A remove @someone for spam".
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } = require('discord.js');
const config = require('../config');
const groq = require('../util/groq');
const actions = require('./actions');
const { embed, log } = require('../util/helpers');

const pending = new Map(); // id -> { actorId, guildId, list, channelId, expires }

const ACTION_DOC = `
Available action types and fields (use names/mentions exactly as given; user/role/channel may be an ID, mention or name):
- kick {user, reason}
- ban {user, reason, delete_days}
- unban {user_id}
- timeout {user, minutes, reason}
- untimeout {user}
- warn {user, reason}
- add_role {user, role}
- remove_role {user, role}
- create_role {name, color, hoist}
- delete_role {role}
- create_channel {name, kind: "text"|"voice"|"category", category, topic, private}
- delete_channel {channel}
- rename_channel {channel, name}
- move_channel {channel, category}
- sort_channels {category}   (omit category to sort every category)
- lock {channel, minutes}
- unlock {channel}
- slowmode {channel, seconds}
- purge {channel, count, user}
- nick {user, nickname}
- say {channel, message}
- announce {channel, title, message, ping_role}
- setup {fresh}   (rebuild the whole server from the template; fresh=true wipes everything first)
"remove @user" from the server means kick. "remove role X from @user" means remove_role. "this channel"/"here" means the current channel.`;

function context(msg) {
  const g = msg.guild;
  const users = msg.mentions.members.filter((m) => m.id !== msg.client.user.id).map((m) => `${m.displayName} (id ${m.id})`);
  const cats = g.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position)
    .map((c) => {
      const kids = g.channels.cache.filter((k) => k.parentId === c.id).map((k) => k.name);
      return `${c.name}: ${kids.join(', ')}`;
    });
  const roles = g.roles.cache.filter((r) => r.id !== g.id && !r.managed).sort((a, b) => b.position - a.position).map((r) => r.name);
  return [
    `Current channel: ${msg.channel.name} (id ${msg.channel.id})`,
    `Mentioned users: ${users.join('; ') || 'none'}`,
    `Mentioned roles: ${msg.mentions.roles.map((r) => `${r.name} (id ${r.id})`).join('; ') || 'none'}`,
    `Mentioned channels: ${msg.mentions.channels.map((c) => `${c.name} (id ${c.id})`).join('; ') || 'none'}`,
    `Categories & channels:\n${cats.join('\n').slice(0, 2500)}`,
    `Roles: ${roles.join(', ').slice(0, 1200)}`,
  ].join('\n');
}

// Regex fallback for when there's no AI key.
function fallbackParse(msg, text) {
  const user = msg.mentions.members.find((m) => m.id !== msg.client.user.id);
  const role = msg.mentions.roles.first();
  const reason = text.replace(/<[@#&!]*\d+>/g, '').replace(/^\s*\w+\s*/, '').replace(/^(for|because)\s+/i, '').trim();
  if (user && /\b(kick|remove|boot)\b/i.test(text) && !role) return [{ type: 'kick', user: user.id, reason }];
  if (user && /\bban\b/i.test(text)) return [{ type: 'ban', user: user.id, reason }];
  if (user && /\b(mute|timeout|shut)\b/i.test(text)) {
    const min = Number(text.match(/(\d+)\s*m/)?.[1]) || 10;
    return [{ type: 'timeout', user: user.id, minutes: min, reason }];
  }
  if (user && role && /\b(give|add)\b/i.test(text)) return [{ type: 'add_role', user: user.id, role: role.id }];
  if (user && role && /\b(remove|take)\b/i.test(text)) return [{ type: 'remove_role', user: user.id, role: role.id }];
  if (/\bunlock\b/i.test(text)) return [{ type: 'unlock', channel: msg.channel.id }];
  if (/\block\b/i.test(text)) return [{ type: 'lock', channel: msg.channel.id }];
  if (/\bsort\b/i.test(text)) return [{ type: 'sort_channels' }];
  return null;
}

async function plan(msg, text) {
  if (!groq.enabled()) {
    const list = fallbackParse(msg, text);
    return list ? { actions: list, reply: '' } : null;
  }
  const result = await groq.chatJson(
    [
      {
        role: 'system',
        content: `You are the admin brain of a Discord bot named ${config.botName}. A server admin is talking to you. Decide if they want server-management actions.\n${ACTION_DOC}\n\nRespond ONLY with JSON: {"actions":[{"type":"...", ...fields}], "reply":"short friendly confirmation or question"}. If the message is just chat (not a request to do something to the server), respond {"actions":[],"chat":true}. If the request is unclear or missing info, respond {"actions":[],"reply":"your clarifying question"}. Never invent user IDs; use the ones given or the names the admin typed.`,
      },
      { role: 'user', content: `${context(msg)}\n\nAdmin (${msg.member.displayName}) says: ${text}` },
    ],
    { maxTokens: 700 },
  );
  if (!result) {
    const list = fallbackParse(msg, text);
    return list ? { actions: list, reply: '' } : null;
  }
  return result;
}

async function execute(msg, member, list) {
  const results = [];
  for (const a of list) {
    if (a.type === 'setup') {
      results.push('🏗️ Use `/setup` to (re)build the server — it shows a full preview and confirm button.');
      continue;
    }
    try {
      results.push(await actions.run(member, a));
    } catch (err) {
      results.push(`❌ ${err.message}`);
    }
  }
  await log(member.guild, 'server_logs', {
    embeds: [embed(config.color.info).setTitle(`🤖 ${member.user.tag} asked King A`).setDescription(results.join('\n').slice(0, 4000))],
  });
  return results;
}

async function handle(msg) {
  const text = msg.content.replace(new RegExp(`<@!?${msg.client.user.id}>`, 'g'), '').trim();
  if (!text) return false;

  const result = await plan(msg, text);
  if (!result || result.chat) return false; // let the banter brain reply
  const list = Array.isArray(result.actions) ? result.actions.filter((a) => a && a.type).slice(0, 10) : [];
  if (!list.length) {
    if (result.reply) {
      await msg.reply({ content: String(result.reply).slice(0, 1500), allowedMentions: { repliedUser: false } });
      return true;
    }
    return false;
  }

  const risky = list.some((a) => actions.RISKY.has(a.type));
  if (risky) {
    const id = `${msg.id}`;
    pending.set(id, { actorId: msg.author.id, guildId: msg.guild.id, list, expires: Date.now() + 60000 });
    setTimeout(() => pending.delete(id), 60000).unref();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`adm:yes:${id}`).setLabel('Do it').setEmoji('✅').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`adm:no:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    await msg.reply({
      embeds: [
        embed(config.color.warn)
          .setTitle('⚠️ Confirm')
          .setDescription(`${result.reply ? `${result.reply}\n\n` : ''}${list.map((a) => `• ${actions.describe(a)}`).join('\n')}`.slice(0, 4000))
          .setFooter({ text: 'Only you can confirm. Expires in 60s.' }),
      ],
      components: [row],
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  await msg.channel.sendTyping().catch(() => {});
  const results = await execute(msg, msg.member, list);
  await msg.reply({ content: results.join('\n').slice(0, 2000), allowedMentions: { repliedUser: false, parse: [] } });
  return true;
}

async function onConfirm(interaction) {
  const [, choice, id] = interaction.customId.split(':');
  const p = pending.get(id);
  if (!p) return interaction.reply({ content: 'This request expired. Ask me again.', flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== p.actorId) return interaction.reply({ content: 'Only the person who asked can confirm this.', flags: MessageFlags.Ephemeral });
  pending.delete(id);
  if (choice === 'no') return interaction.update({ content: '❎ Cancelled.', embeds: [], components: [] });
  await interaction.update({ content: '⏳ Working on it…', embeds: [], components: [] });
  const results = await execute(interaction.message, interaction.member, p.list);
  await interaction.editReply({ content: results.join('\n').slice(0, 2000), allowedMentions: { parse: [] } });
}

module.exports = { handle, components: { adm: onConfirm }, fallbackParse };
