const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const store = require('../store');
const groq = require('../util/groq');
const { embed, todayKey } = require('../util/helpers');
const levels = require('../features/levels');

const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Everything King A can do'),
  async execute(i) {
    const e = embed(config.color.main)
      .setTitle('👑 King A')
      .setDescription('Server manager, game host and resident trash-talker.')
      .addFields(
        { name: '🎮 Games', value: '`/wordle` (official) + `/wordlestats` · `/play` Discord games (Putt Party, Sketch Heads, Poker…) · `/trivia` `/wyr` `/rps` `/8ball`\nCounting & word-chain channels' },
        { name: '📈 Progress', value: '`/rank` `/levels` `/leaderboard` `/daily` `/wars`' },
        { name: '🚩 Safety', value: '`/report` someone, or right-click a message → Apps → **Report message**' },
        { name: '🔥 Banter', value: '`/roastme` (needs Roast Me role) `/hottake`\nMention me or reply to me to chat' },
        { name: '🛡️ Staff', value: '`/setup2` (tidy, no wipe) `/setup` `/console` `/mod` `/channel` `/channelrule` `/role` `/announce` `/giveaway` `/award` `/selfroles` `/banter`\nOr type in the console channel in plain English' },
      );
    return i.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  },
};

const ping = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check if King A is awake'),
  async execute(i) {
    return i.reply(`🏓 Pong! ${Math.round(i.client.ws.ping)}ms · AI ${groq.enabled() ? 'online 🧠' : 'offline'}`);
  },
};

const rank = {
  data: new SlashCommandBuilder().setName('rank').setDescription('Your level & stats').addUserOption((o) => o.setName('user').setDescription('Someone else')),
  async execute(i) {
    const user = i.options.getUser('user') || i.user;
    const member = await i.guild.members.fetch(user.id).catch(() => null);
    if (!member) return i.reply({ content: 'Member not found.', flags: MessageFlags.Ephemeral });
    return i.reply({ embeds: [levels.rankCard(member)] });
  },
};

const leaderboard = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top members')
    .addStringOption((o) =>
      o.setName('by').setDescription('Ranking').addChoices(
        { name: 'XP / level', value: 'xp' },
        { name: 'Coins', value: 'coins' },
        { name: 'Wordle', value: 'wordle' },
        { name: 'Bot Slayer wins', value: 'slayer' },
      ),
    ),
  async execute(i) {
    const by = i.options.getString('by') || 'xp';
    if (by === 'wordle') {
      const rows = require('../features/wordletracker').leaderboardRows(i.guild.id);
      const medals = ['🥇', '🥈', '🥉'];
      const text = rows.map((r, n) => `${medals[n] || `**${n + 1}.**`} <@${r.id}> — ${r.wins} wins · avg ${r.avg < 9 ? r.avg.toFixed(2) : '—'} · 🔥 ${r.streak}`).join('\n');
      return i.reply({ embeds: [embed(0x538d4e).setTitle('🟩 Wordle leaderboard').setDescription(text || 'No results yet. Play `/wordle` and paste your result in the wordle channel!')], allowedMentions: { parse: [] } });
    }
    const val = {
      xp: (u) => u.xp,
      coins: (u) => u.coins,
      slayer: (u) => u.slayer || 0,
    }[by];
    const label = { xp: 'XP', coins: '🪙', slayer: '🗡️ wins' }[by];
    const rows = Object.entries(store.guild(i.guild.id).users)
      .map(([id, u]) => ({ id, v: val(u), lvl: u.level }))
      .filter((r) => r.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];
    const text = rows.map((r, n) => `${medals[n] || `**${n + 1}.**`} <@${r.id}> — ${r.v.toLocaleString()} ${label}${by === 'xp' ? ` (lvl ${r.lvl})` : ''}`).join('\n');
    return i.reply({ embeds: [embed(config.color.purple).setTitle('🏆 Leaderboard').setDescription(text || 'Nobody yet. Be the first!')], allowedMentions: { parse: [] } });
  },
};

const daily = {
  data: new SlashCommandBuilder().setName('daily').setDescription('Claim free coins (bigger with a streak)'),
  async execute(i) {
    const u = store.user(i.guild.id, i.user.id);
    const today = todayKey();
    const yesterday = todayKey(new Date(Date.now() - 86400000));
    if (u.lastDailyKey === today) return i.reply({ content: '⏳ Already claimed today. Come back tomorrow!', flags: MessageFlags.Ephemeral });
    u.streak = u.lastDailyKey === yesterday ? u.streak + 1 : 1;
    u.lastDailyKey = today;
    const coins = 50 + Math.min(u.streak, 30) * 10;
    u.coins += coins;
    store.markDirty();
    await levels.addXp(i.member, 20, i.channel);
    return i.reply(`💰 **+🪙 ${coins}** and 20 XP! 🔥 Streak: **${u.streak} day${u.streak > 1 ? 's' : ''}**${u.streak % 7 === 0 ? ' — weekly streak bonus vibes! 🎉' : ''}`);
  },
};

const banterCmd = {
  data: new SlashCommandBuilder()
    .setName('banter')
    .setDescription('King A\'s chat personality (kill switch)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('pause').setDescription('Stop all automatic chatting'))
    .addSubcommand((s) => s.setName('resume').setDescription('Let King A chat again'))
    .addSubcommand((s) => s.setName('status').setDescription('Is banter on?'))
    .addSubcommand((s) => s.setName('forgive').setDescription('Let King A talk to someone it backed off from').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))),
  async execute(i) {
    const g = store.guild(i.guild.id);
    const sub = i.options.getSubcommand();
    if (sub === 'pause') g.banter.paused = true;
    if (sub === 'resume') g.banter.paused = false;
    if (sub === 'forgive') delete g.banter.backOff[i.options.getUser('user').id];
    store.markDirty();
    const backedOff = Object.entries(g.banter.backOff).filter(([, t]) => t > Date.now()).length;
    return i.reply({
      content: `${g.banter.paused ? '⏸️ Banter is **paused**. I\'ll only do commands.' : '▶️ Banter is **on**.'} AI: ${groq.enabled() ? 'online' : 'offline (using line bank)'} · Backing off from ${backedOff} member(s).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

const serverinfo = {
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Server stats'),
  async execute(i) {
    const g = i.guild;
    return i.reply({
      embeds: [
        embed(config.color.info)
          .setTitle(g.name)
          .setThumbnail(g.iconURL())
          .addFields(
            { name: 'Members', value: `${g.memberCount}`, inline: true },
            { name: 'Channels', value: `${g.channels.cache.size}`, inline: true },
            { name: 'Roles', value: `${g.roles.cache.size}`, inline: true },
            { name: 'Boosts', value: `${g.premiumSubscriptionCount || 0}`, inline: true },
            { name: 'Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
            { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
          ),
      ],
      allowedMentions: { parse: [] },
    });
  },
};

const wordlestats = {
  data: new SlashCommandBuilder().setName('wordlestats').setDescription('Your stats from the official Wordle').addUserOption((o) => o.setName('user').setDescription('Someone else')),
  async execute(i) {
    const user = i.options.getUser('user') || i.user;
    const member = await i.guild.members.fetch(user.id).catch(() => null);
    if (!member) return i.reply({ content: 'Member not found.', flags: MessageFlags.Ephemeral });
    return i.reply({ embeds: [require('../features/wordletracker').statsEmbed(member)] });
  },
};

module.exports = { commands: [help, ping, rank, leaderboard, daily, banterCmd, serverinfo, wordlestats] };
