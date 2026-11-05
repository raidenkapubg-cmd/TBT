// Plain-English server control for staff.
// Works two ways: mention King A anywhere, or just type in the #king-a-console channel (no @ needed).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } = require('discord.js');
const config = require('../config');
const store = require('../store');
const groq = require('../util/groq');
const actions = require('./actions');
const { embed, log } = require('../util/helpers');

const pending = new Map(); // id -> { actorId, list, expires }

const ACTION_DOC = `
ACTIONS (fields in braces; user/role/channel/category can be an ID, mention or name; arrays as JSON arrays):
Members:
- kick {user, reason}
- ban {user, reason, delete_days}
- tempban {user, days, reason, delete_days, hacked}         // banned for N days, auto-unbanned, DM'd a rejoin link
- softban {user, reason}                                    // kick + wipe last 24h of their messages
- unban {user_id}
- timeout {user, minutes, reason} / untimeout {user}
- warn {user, reason}
- nick {user, nickname}
- dm {user, message}
- add_role {user, role} / remove_role {user, role}
- add_role_to_all {role, has_role} / remove_role_from_all {role}
Channels:
- create_channel {name, kind: "text"|"voice"|"category"|"forum", category, topic, private, visible_to: [roles], read_only, slowmode, user_limit}
- edit_channel {channel, name, topic, slowmode, nsfw, user_limit, bitrate, category, position}
- delete_channel {channel}
- rename_channel {channel, name}
- move_channel {channel, category}
- sort_channels {category}
- lock {channel, minutes} / unlock {channel}
- slowmode {channel, seconds}
- purge {channel, count, user}
- set_permissions {channel, target: role|member|"everyone", allow: [perms], deny: [perms], reset: [perms]}
    perms: ViewChannel, SendMessages, ReadMessageHistory, AddReactions, AttachFiles, EmbedLinks, Connect, Speak, Stream,
           CreatePublicThreads, MentionEveryone, UseExternalEmojis, UseApplicationCommands, ManageMessages, ManageChannels
- sync_permissions {channel}
- set_channel_rule {channel, rule, ...options}   rules:
    trap {action: "tempban"|"softban"|"kick"|"ban"|"timeout", days, minutes}  // anyone who posts gets punished (staff immune)
    media_only {} | text_only {} | no_links {} | no_xp {} | one_message {} | auto_thread {name}
    auto_delete {seconds} | auto_react {emojis: ["👍","🔥"]} | min_level {level}
- clear_channel_rules {channel, rule}
Roles:
- create_role {name, color, hoist, mentionable}
- edit_role {role, name, color, hoist, mentionable, add_perms: [perms], remove_perms: [perms]}
- move_role {role, above | below}
- delete_role {role}
Server:
- edit_server {name, verification_level: none|low|medium|high|highest, afk_channel, afk_timeout_minutes, only_mentions}
- create_invite {channel, max_age_hours, max_uses}
- announce {channel, title, message, ping_role}
- say {channel, message}
- antispam {enabled, block_invites}
- banter {paused}
Levels:
- add_xp {user, amount} / set_level {user, level}
- set_level_role {level, role, color}   // role is created if it doesn't exist
- remove_level_role {level}
- sync_level_roles {}
Games (Discord Activities in voice channels):
- launch_activity {game, voice}   // e.g. Putt Party, Sketch Heads, Poker Night, Chess, SpellCast, Watch Together…
- add_activity {name, id, emoji}  // add another Discord Activity by its application ID
Reports:
- report {kind: "server"|"member"|"warnings"|"bans"|"rules"|"levels", user}
Rebuild:
- setup {fresh}   // also for "reorganize / tidy / clean up the server" (points them to /setup2)

Notes: "remove @user" (from the server) = kick. To make a brand-new custom channel with behaviour, use create_channel then set_channel_rule in the same list.
"this channel"/"here" = the current channel. Chain as many actions as needed, in order.`;

function context(msg) {
  const g = msg.guild;
  const users = msg.mentions.members?.filter((m) => m.id !== msg.client.user.id).map((m) => `${m.displayName} (id ${m.id})`) || [];
  const cats = g.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position)
    .map((c) => `${c.name}: ${g.channels.cache.filter((k) => k.parentId === c.id).map((k) => k.name).join(', ')}`);
  const loose = g.channels.cache.filter((c) => !c.parentId && c.type !== ChannelType.GuildCategory).map((c) => c.name);
  const roles = g.roles.cache.filter((r) => r.id !== g.id && !r.managed).sort((a, b) => b.position - a.position).map((r) => r.name);
  return [
    `Current channel: ${msg.channel.name} (id ${msg.channel.id})`,
    `Mentioned users: ${users.join('; ') || 'none'}`,
    `Mentioned roles: ${msg.mentions.roles.map((r) => `${r.name} (id ${r.id})`).join('; ') || 'none'}`,
    `Mentioned channels: ${msg.mentions.channels.map((c) => `${c.name} (id ${c.id})`).join('; ') || 'none'}`,
    `Categories & channels:\n${cats.join('\n').slice(0, 3000)}${loose.length ? `\n(no category): ${loose.join(', ')}` : ''}`,
    `Roles (top→bottom): ${roles.join(', ').slice(0, 1500)}`,
  ].join('\n');
}

// Regex fallback for when there's no AI key.
function fallbackParse(msg, text) {
  const user = msg.mentions.members.find((m) => m.id !== msg.client.user.id);
  const role = msg.mentions.roles.first();
  const reason = text.replace(/<[@#&!]*\d+>/g, '').replace(/^\s*\w+\s*/, '').replace(/^(for|because)\s+/i, '').trim();
  if (user && /\btemp\s*ban\b|\bban\b.*\b(\d+)\s*d(ay)?s?\b/i.test(text)) {
    return [{ type: 'tempban', user: user.id, days: Number(text.match(/(\d+)\s*d/i)?.[1]) || 7, reason }];
  }
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
  if (/\breport\b/i.test(text)) return [{ type: 'report', kind: user ? 'member' : 'server', user: user?.id }];
  return null;
}

function remember(guildId, role, content) {
  const g = store.guild(guildId);
  g.console = [...(g.console || []), { role, content: String(content).slice(0, 800) }].slice(-12);
  store.markDirty();
}

async function plan(msg, text, { inConsole }) {
  if (!groq.enabled()) {
    const list = fallbackParse(msg, text);
    return list ? { actions: list, reply: '' } : inConsole ? { actions: [], reply: '🧠 My AI brain is offline (no GROQ_API_KEY), so I only understand simple things like "kick @user", "timeout @user 10m", "lock", "sort", "report". Slash commands still work for everything.' } : null;
  }
  const history = inConsole ? (store.guild(msg.guild.id).console || []) : [];
  const result = await groq.chatJson(
    [
      {
        role: 'system',
        content: `You are ${config.botName}, the server-management assistant of a Discord server. An admin talks to you in plain English (any language/Hinglish). Turn their request into actions.\n${ACTION_DOC}\n\nRespond ONLY with JSON: {"actions":[{"type":"...", ...fields}], "reply":"one short friendly line"}.\n- If they ask a question or just chat (no server change wanted), respond {"actions":[], "reply":"your helpful answer"}${inConsole ? '' : ' or {"actions":[],"chat":true} if it is casual banter'}.\n- If something essential is missing or ambiguous, respond {"actions":[], "reply":"a short clarifying question"}.\n- Never invent user IDs; use given IDs or the names typed. Use exact channel/role names from the lists when possible.\n- Pick sensible defaults (e.g. trap channel → tempban 7 days) instead of asking when the intent is clear.`,
      },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: `${context(msg)}\n\nAdmin (${msg.member.displayName}) says: ${text}` },
    ],
    { maxTokens: 1200 },
  );
  if (!result) {
    const list = fallbackParse(msg, text);
    return list ? { actions: list, reply: '' } : inConsole ? { actions: [], reply: '😵 I couldn\'t reach my AI brain just now. Try again in a moment.' } : null;
  }
  return result;
}

async function execute(member, list) {
  const results = [];
  for (const a of list) {
    if (a.type === 'setup') {
      results.push('🏗️ Use `/setup2` to reorganize the server without wiping it (it shows a full plan first), or `/setup` to build from scratch.');
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

async function send(msg, text) {
  const chunks = String(text).match(/[\s\S]{1,1900}(\n|$)/g) || [String(text).slice(0, 1900)];
  for (const [n, c] of chunks.entries()) {
    if (n === 0) await msg.reply({ content: c, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {});
    else await msg.channel.send({ content: c, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

/** Returns true if the message was handled as an admin request. */
async function handle(msg, { inConsole = false } = {}) {
  const text = msg.content.replace(new RegExp(`<@!?${msg.client.user.id}>`, 'g'), '').trim();
  if (!text) return false;

  await msg.channel.sendTyping().catch(() => {});
  const result = await plan(msg, text, { inConsole });
  if (!result || (result.chat && !inConsole)) return false; // let the banter brain reply
  const list = Array.isArray(result.actions) ? result.actions.filter((a) => a && a.type).slice(0, 15) : [];
  if (inConsole) remember(msg.guild.id, 'user', text);

  if (!list.length) {
    const reply = result.reply || (inConsole ? '🤔 Not sure what to do with that — try rephrasing?' : null);
    if (!reply) return false;
    await send(msg, reply);
    if (inConsole) remember(msg.guild.id, 'assistant', reply);
    return true;
  }

  const risky = list.filter((a) => actions.RISKY.has(a.type));
  if (risky.length) {
    const id = `${msg.id}`;
    pending.set(id, { actorId: msg.author.id, list, inConsole, expires: Date.now() + 120000 });
    setTimeout(() => pending.delete(id), 120000).unref();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`adm:yes:${id}`).setLabel('Do it').setEmoji('✅').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`adm:no:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    await msg.reply({
      embeds: [
        embed(config.color.warn)
          .setTitle('⚠️ Confirm')
          .setDescription(`${result.reply ? `${result.reply}\n\n` : ''}${list.map((a) => `${actions.RISKY.has(a.type) ? '⚠️' : '•'} ${actions.describe(a)}`).join('\n')}`.slice(0, 4000))
          .setFooter({ text: 'Only you can confirm. Expires in 2 minutes.' }),
      ],
      components: [row],
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  const results = await execute(msg.member, list);
  const out = `${result.reply ? `${result.reply}\n` : ''}${results.join('\n')}`;
  await send(msg, out);
  if (inConsole) remember(msg.guild.id, 'assistant', `Done: ${results.join(' | ')}`);
  return true;
}

async function onConfirm(interaction) {
  const [, choice, id] = interaction.customId.split(':');
  const p = pending.get(id);
  if (!p) return interaction.reply({ content: 'This request expired. Ask me again.', flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== p.actorId) return interaction.reply({ content: 'Only the person who asked can confirm this.', flags: MessageFlags.Ephemeral });
  pending.delete(id);
  if (choice === 'no') {
    if (p.inConsole) remember(interaction.guild.id, 'assistant', 'Cancelled by admin.');
    return interaction.update({ content: '❎ Cancelled.', embeds: [], components: [] });
  }
  await interaction.update({ content: '⏳ Working on it…', embeds: [], components: [] });
  const results = await execute(interaction.member, p.list);
  if (p.inConsole) remember(interaction.guild.id, 'assistant', `Done: ${results.join(' | ')}`);
  await interaction.editReply({ content: results.join('\n').slice(0, 2000), allowedMentions: { parse: [] } });
}

module.exports = { handle, components: { adm: onConfirm }, fallbackParse, execute };
