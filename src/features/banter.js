// King A's personality: drop-ins, replies, roasts, comeback battles.
const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config');
const store = require('../store');
const groq = require('../util/groq');
const { isSafe, looksAngry, clean } = require('../util/safety');
const { pick, embed, log, hasRoleKey, todayKey, isStaff } = require('../util/helpers');
const tpl = require('../setup/template');
const lines = require('./lines');

const B = config.banter;
const BANTER_KEYS = tpl.categories.flatMap((c) => c.channels).filter((c) => c.banter).map((c) => c.key);

// in-memory per-channel state
const recent = new Map(); // channelId -> [{id, name, content, ts}]
const engaged = new Map(); // channelId -> { until, repliesLeft }
const roastMessages = new Map(); // botMessageId -> targetUserId
const battles = new Map(); // battleId -> { userId, votes: Map(userId -> 'member'|'bot'), ends }
const replyCooldown = new Map(); // channelId -> timestamp

function persona(guildName) {
  return [
    `You are King A, the resident banter bot in "${guildName}", a Discord community built around ${config.brand}, a gaming gear brand (mice, keyboards, headsets, mousepads). Members are competitive gamers on PC and mobile, many from India.`,
    'Personality: cocky but lovable, quick-witted, playful trash talk like a friend in the squad. Light Hinglish is fine occasionally. You lose sometimes and admit it gracefully.',
    'Style: ONE short message, max 2 sentences, under 200 characters. Casual, at most one emoji. No hashtags. Never start with your own name. Never use quotes around your reply.',
    'HARD RULES: Only joke about gameplay, ranks, aim, game choices, setups, gear, PC vs mobile. NEVER mention looks, body, family, religion, caste, region, gender, sexuality, money or real life. No swearing, no slurs, no sexual content, nothing a teenager shouldn\'t read. Never ping @everyone or @here.',
    `Do not invent ${config.brand} prices, discounts, release dates or promises. If asked about products or support, point them to the support channel.`,
    'If the conversation is serious (someone upset, sad, a real conflict, a support problem) reply with exactly: SKIP',
  ].join('\n');
}

function isBanterChannel(guild, channelId) {
  const g = store.guild(guild.id);
  const ids = BANTER_KEYS.map((k) => g.channels[k]).filter(Boolean);
  if (ids.length) return ids.includes(channelId);
  // Before /setup: allow channels with "general" in the name.
  const ch = guild.channels.cache.get(channelId);
  return !!ch && /general/i.test(ch.name);
}

function isQuiet(guild, channelId) {
  const g = store.guild(guild.id);
  return [...tpl.quietZones].some((k) => g.channels[k] === channelId);
}

function canTarget(member) {
  const g = store.guild(member.guild.id);
  if (g.banter.backOff[member.id] && g.banter.backOff[member.id] > Date.now()) return false;
  const day = todayKey();
  const count = g.banter.daily[day]?.[member.id] || 0;
  return count < B.perMemberDailyLimit;
}

function countInteraction(guildId, userId) {
  const g = store.guild(guildId);
  const day = todayKey();
  if (!g.banter.daily[day]) g.banter.daily = { [day]: {} }; // drop old days
  g.banter.daily[day][userId] = (g.banter.daily[day][userId] || 0) + 1;
  store.markDirty();
}

function isRoastable(member) {
  if (!hasRoleKey(member, 'roast_me')) return false;
  const days = (Date.now() - (member.joinedTimestamp || 0)) / 86400000;
  return days >= B.newMemberDays;
}

function transcript(channelId, limit = 12) {
  return (recent.get(channelId) || []).slice(-limit).map((m) => `${m.name}: ${m.content}`).join('\n');
}

async function generate(guild, task, channelId, extra = '') {
  const prompt = [`Recent chat:\n${transcript(channelId) || '(quiet)'}`, extra, `Task: ${task}`].filter(Boolean).join('\n\n');
  const text = await groq.chat([
    { role: 'system', content: persona(guild.name) },
    { role: 'user', content: prompt },
  ]);
  if (!text) return null;
  const out = clean(text);
  if (/^SKIP\b/i.test(out)) return 'SKIP';
  return isSafe(out) ? out : null;
}

async function botLog(guild, channel, text, why) {
  await log(guild, 'bot_logs', {
    embeds: [embed(0x2b2d31).setDescription(`**${why}** in ${channel}\n> ${text.slice(0, 900)}`).setTimestamp()],
  });
}

function participants(msgs) {
  const seen = new Map();
  for (const m of msgs) seen.set(m.id, m.name);
  return seen;
}

// ------------------------------------------------------------- drop-in
async function maybeDropIn(msg) {
  const g = store.guild(msg.guild.id);
  const now = Date.now();
  const buf = (recent.get(msg.channel.id) || []).filter((m) => now - m.ts < B.activeWindowMs);
  const people = participants(buf);
  if (buf.length < B.activeMinMessages || people.size < B.activeMinPeople) return;
  if (now - (g.banter.lastDropIn[msg.channel.id] || 0) < B.dropInCooldownMs) return;
  if (Math.random() > B.dropInChance) return;

  g.banter.lastDropIn[msg.channel.id] = now;
  store.markDirty();

  const members = [...people.keys()].map((id) => msg.guild.members.cache.get(id)).filter(Boolean);
  const roastable = members.filter((m) => isRoastable(m) && canTarget(m)).map((m) => m.displayName);
  const extra = roastable.length
    ? `You MAY playfully roast these people about their gameplay (they opted in): ${roastable.join(', ')}. Everyone else: only joke about the topic, not the person.`
    : 'Nobody here opted in to roasts: joke about the topic only, not any person.';

  let text = await generate(msg.guild, 'Jump into this conversation with one short, funny message that reacts to what they are actually talking about.', msg.channel.id, extra);
  if (text === 'SKIP') return;
  if (!text) text = pick(lines.DROP_INS);

  await msg.channel.sendTyping().catch(() => {});
  await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1500));
  const sent = await msg.channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => null);
  if (!sent) return;
  pushRecent(msg.channel.id, { id: msg.client.user.id, name: 'King A', content: text, ts: Date.now() });
  engaged.set(msg.channel.id, { until: Date.now() + 4 * 60 * 1000, repliesLeft: B.followUpReplies });
  await botLog(msg.guild, msg.channel, text, 'Drop-in');
}

// ------------------------------------------------------------- follow-up / direct reply
async function reply(msg, { direct }) {
  const member = msg.member;
  const g = store.guild(msg.guild.id);
  const now = Date.now();

  if (g.banter.backOff[member.id] > now) {
    if (direct) await msg.react('🤐').catch(() => {});
    return;
  }

  // Backs off on real anger
  const repliedToBot = msg.reference && (await msg.fetchReference().catch(() => null))?.author?.id === msg.client.user.id;
  if ((direct || repliedToBot) && looksAngry(msg.content)) {
    g.banter.backOff[member.id] = now + B.backOffHours * 3600 * 1000;
    store.markDirty();
    const text = pick(['GG, you got me 🏳️', 'aight aight, I\'ll leave you alone. GG 🤝', 'say less. GG 🫡']);
    await msg.reply({ content: text, allowedMentions: { repliedUser: false } }).catch(() => {});
    await botLog(msg.guild, msg.channel, text, `Backed off from ${member.user.tag} for 24h`);
    return;
  }

  // Comeback battle: someone roasted by the bot fires back
  if (repliedToBot && roastMessages.get(msg.reference.messageId) === member.id) {
    roastMessages.delete(msg.reference.messageId);
    return startBattle(msg);
  }

  if (!direct && !canTarget(member)) return;
  if (now - (replyCooldown.get(msg.channel.id) || 0) < 8000) return;
  replyCooldown.set(msg.channel.id, now);

  const roastable = isRoastable(member);
  const extra = roastable
    ? `${member.displayName} opted in to roasts: you can playfully roast their gameplay.`
    : `${member.displayName} did NOT opt in to roasts: be witty but don't roast them personally.`;
  const task = direct
    ? `${member.displayName} just talked to you: "${msg.content.slice(0, 300)}". Reply to them.`
    : `Keep the banter going: reply to ${member.displayName}'s latest message.`;

  let text = await generate(msg.guild, task, msg.channel.id, extra);
  if (text === 'SKIP') return;
  if (!text) {
    if (!groq.enabled() && direct) text = pick(['I\'d roast you but my AI brain is offline. Consider yourself lucky. 😤', 'brb, recharging my wit ⚡']);
    else if (!direct) return;
    else text = pick(lines.DROP_INS);
  }

  await msg.channel.sendTyping().catch(() => {});
  await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
  const sent = await msg.reply({ content: text, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => null);
  if (!sent) return;
  if (roastable) roastMessages.set(sent.id, member.id);
  if (roastMessages.size > 300) roastMessages.delete(roastMessages.keys().next().value);
  countInteraction(msg.guild.id, member.id);
  pushRecent(msg.channel.id, { id: msg.client.user.id, name: 'King A', content: text, ts: Date.now() });
  await botLog(msg.guild, msg.channel, text, direct ? `Reply to ${member.user.tag}` : `Follow-up to ${member.user.tag}`);
}

// ------------------------------------------------------------- comeback battles
async function startBattle(msg) {
  const id = `${msg.id}`;
  const counter =
    (await generate(msg.guild, `${msg.member.displayName} fired back at your roast with: "${msg.content.slice(0, 200)}". Give a short counter-roast about gameplay. Keep it fair so they could still win.`, msg.channel.id)) ||
    pick(['that\'s cute. did your teammates write that for you?', 'bold words from someone with that K/D', 'I\'ve heard better comebacks from bots. and I AM a bot.']);
  if (counter === 'SKIP') return;

  battles.set(id, { userId: msg.author.id, votes: new Map(), ends: Date.now() + 120000 });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`battle:member:${id}`).setLabel(msg.member.displayName.slice(0, 40)).setEmoji('🔥').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`battle:bot:${id}`).setLabel('King A').setEmoji('🤖').setStyle(ButtonStyle.Danger),
  );
  const battleMsg = await msg.reply({
    content: `${counter}\n\n⚔️ **COMEBACK BATTLE!** Who won this exchange? Vote in 2 minutes. If <@${msg.author.id}> wins, they get **+50 XP** and the **Bot Slayer** role.`,
    components: [row],
    allowedMentions: { parse: [] },
  });
  await botLog(msg.guild, msg.channel, counter, `Comeback battle vs ${msg.author.tag}`);

  setTimeout(async () => {
    const b = battles.get(id);
    battles.delete(id);
    if (!b) return;
    const memberVotes = [...b.votes.values()].filter((v) => v === 'member').length;
    const botVotes = b.votes.size - memberVotes;
    const won = memberVotes >= botVotes && b.votes.size > 0;
    let result;
    if (won) {
      result = `🏆 **<@${b.userId}> wins ${memberVotes}–${botVotes}!** Fine. FINE. You got me. +50 XP & 🗡️ Bot Slayer.`;
      const member = await msg.guild.members.fetch(b.userId).catch(() => null);
      if (member) {
        await require('./levels').addXp(member, 50, msg.channel);
        const r = require('../util/helpers').role(msg.guild, 'bot_slayer');
        if (r) await member.roles.add(r).catch(() => {});
        store.user(msg.guild.id, b.userId).slayer++;
        store.markDirty();
      }
    } else if (b.votes.size === 0) {
      result = '😶 Nobody voted. I\'m calling that a win for me. 🤖';
    } else {
      result = `🤖 **King A wins ${botVotes}–${memberVotes}.** Undefeated. Mostly.`;
    }
    await battleMsg.edit({ components: [] }).catch(() => {});
    await battleMsg.reply({ content: result, allowedMentions: { parse: [] } }).catch(() => {});
  }, 120000);
}

async function onBattleVote(interaction) {
  const [, side, id] = interaction.customId.split(':');
  const b = battles.get(id);
  if (!b) return interaction.reply({ content: 'This battle is over!', flags: MessageFlags.Ephemeral });
  if (interaction.user.id === b.userId) return interaction.reply({ content: 'You can\'t vote in your own battle 😏', flags: MessageFlags.Ephemeral });
  b.votes.set(interaction.user.id, side);
  return interaction.reply({ content: `Vote counted: ${side === 'bot' ? '🤖 King A' : '🔥 the challenger'}`, flags: MessageFlags.Ephemeral });
}

// ------------------------------------------------------------- /roastme
async function roastMember(member, channel) {
  const u = store.user(member.guild.id, member.id);
  const roleNames = member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => r.name.replace(/^\S+\s/, '')).slice(0, 12);
  const facts = `Name: ${member.displayName}. Level ${u.level}, ${u.messages} messages sent, ${u.fish?.caught || 0} fish caught, wordle wins ${u.wordle?.won || 0}/${u.wordle?.played || 0}. Roles: ${roleNames.join(', ') || 'none'}.`;
  const text = await groq.chat([
    { role: 'system', content: persona(member.guild.name) },
    { role: 'user', content: `${member.displayName} asked to be roasted. Use these server stats, roles and game choices for material. Gameplay/setup/server-activity only. ${facts}\nTask: one savage-but-friendly roast, max 2 sentences.` },
  ]);
  const out = text && isSafe(clean(text)) && !/^SKIP/i.test(text) ? clean(text) : null;
  const fallback = [
    `Level ${u.level} after ${u.messages} messages? Even the welcome bot has more XP than your aim. 🎯`,
    'I\'d roast your aim but it\'s already been flamed by every teammate you\'ve had.',
    'Your setup is fine. It\'s the person using it I\'m worried about. 🖱️',
    'You picked Roast Me like you pick fights in ranked: confidently and for no reason.',
  ];
  const final = out || pick(fallback);
  if (channel) await botLog(member.guild, channel, final, `/roastme for ${member.user.tag}`);
  return final;
}

// ------------------------------------------------------------- plumbing
function pushRecent(channelId, entry) {
  const arr = recent.get(channelId) || [];
  arr.push(entry);
  while (arr.length > 20) arr.shift();
  recent.set(channelId, arr);
}

function lastActivity(channelId) {
  const arr = recent.get(channelId);
  return arr?.length ? arr[arr.length - 1].ts : 0;
}

function init(client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot || !msg.member) return;
    const g = store.guild(msg.guild.id);
    if (msg.content) {
      pushRecent(msg.channel.id, { id: msg.author.id, name: msg.member.displayName, content: msg.content.slice(0, 300), ts: Date.now() });
    }

    const mentioned = msg.mentions.users.has(client.user.id) && !msg.mentions.everyone;
    const repliedToBot = msg.mentions.repliedUser?.id === client.user.id;

    // Staff talking to the bot → natural-language admin control
    if (mentioned && isStaff(msg.member)) {
      const handled = await require('./admin-ai').handle(msg);
      if (handled) return;
    }

    if (g.banter.paused) return;
    if (isQuiet(msg.guild, msg.channel.id)) return;

    try {
      if (mentioned || repliedToBot) return await reply(msg, { direct: true });

      if (!isBanterChannel(msg.guild, msg.channel.id)) return;

      const eng = engaged.get(msg.channel.id);
      if (eng && eng.until > Date.now() && eng.repliesLeft > 0) {
        if (Math.random() < 0.5) {
          eng.repliesLeft--;
          return await reply(msg, { direct: false });
        }
        return;
      }
      await maybeDropIn(msg);
    } catch (err) {
      console.error('[banter]', err);
    }
  });
}

module.exports = {
  init,
  components: { battle: onBattleVote },
  roastMember,
  isRoastable,
  lastActivity,
  generate,
  persona,
  botLog,
  pushRecent,
};
