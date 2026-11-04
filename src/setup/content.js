// Messages /setup posts into the new channels.
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { embed } = require('../util/helpers');
const { selfRoleCategories } = require('./template');

const B = config.brand;

function rulesEmbeds() {
  return [
    embed(config.color.main)
      .setTitle('📜 The Rules (short, because nobody reads long ones)')
      .setDescription(
        [
          '**1. Be cool.** Trash talk gameplay, never people. No insults about looks, family, religion, caste, region, gender or sexuality.',
          '**2. No NSFW, slurs or gore.** Many members are teenagers. Keep it clean.',
          '**3. No spam or self-promo** outside the channels made for it. No DM advertising.',
          '**4. Right channel, right chat.** Support questions → support. Memes → memes. LFG → lfg.',
          '**5. No cheats, hacks, account selling** or anything that breaks game ToS.',
          '**6. English & Hinglish welcome.** Keep it understandable for everyone.',
          '**7. Giveaways are for real members.** Alts and fake entries get disqualified and banned.',
          '**8. Staff have the final say.** Disagree? DM a mod calmly — not a public war.',
          '**9. Follow Discord ToS** — discord.com/terms',
        ].join('\n\n'),
      )
      .setFooter({ text: 'Breaking rules = warn → timeout → kick → ban. King A keeps receipts.' }),
  ];
}

function aboutEmbeds(guild) {
  return [
    embed(config.color.main)
      .setTitle(`🔴 Welcome to the ${B} community`)
      .setDescription(
        [
          `This is the home of **${B}** — gear, setups and the people who use them. Games live here too, but the gear and the people come first.`,
          '',
          '**What happens here**',
          '🎙️ **Gear Talk** — every Wednesday: setup reviews, settings help, product Q&A with the team',
          '🌙 **Game Night** — every Saturday, game picked by a Monday poll',
          '🏆 **Skirmish** — a monthly tournament, the game rotates',
          '🖥️ **Setup of the Month** & 🎬 **Clip of the Week** — win roles and get featured',
          '🌟 **Insiders** — hit level 10 to unlock early peeks, beta tests and priority drops',
          '⚔️ **PC vs Mobile Wars** — pick a side, every message earns your team points',
          '',
          '**Get started**',
          '1. Grab your roles in the self-roles channel',
          '2. Introduce yourself in introductions',
          '3. Say hi in general — King A might say hi back 👀',
        ].join('\n'),
      )
      .setThumbnail(guild.iconURL() || null),
  ];
}

function selfRolesPanel() {
  const e = embed(config.color.purple)
    .setTitle('🎭 Build Your Character')
    .setDescription(
      [
        'Pick from the menus below. Change your mind any time — just pick again.',
        '',
        ...selfRoleCategories.map((c) => `**${c.title}**${c.single ? ' *(pick one)*' : ''}\n${c.blurb}`),
      ].join('\n\n'),
    )
    .setFooter({ text: 'Pick nothing in a menu to clear that category.' });

  const rows = selfRoleCategories.map((c) =>
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`sr:${c.key}`)
        .setPlaceholder(c.title)
        .setMinValues(0)
        .setMaxValues(c.single ? 1 : c.options.length)
        .addOptions(
          c.options.map((o) => ({
            label: o.name.replace(/^\S+\s/, ''),
            value: o.key,
            description: o.desc.slice(0, 100),
            emoji: o.emoji,
          })),
        ),
    ),
  );
  return { embeds: [e], components: rows };
}

function introTemplate() {
  return {
    embeds: [
      embed(config.color.good)
        .setTitle('🙋 Introduce yourself!')
        .setDescription(
          [
            'Copy this, fill it in, and the Welcome Squad will come say hi:',
            '```',
            'Name / nickname:',
            'Main game + rank:',
            'PC, mobile or console:',
            'Current setup (mouse/keyboard/headset):',
            'One fun fact:',
            '```',
          ].join('\n'),
        ),
    ],
  };
}

function welcomeHeader() {
  return {
    embeds: [
      embed(config.color.main)
        .setTitle(`👋 New arrivals`)
        .setDescription('Every new member gets announced here. Hit **👋 Wave** on a card to welcome them!'),
    ],
  };
}

function lfgGuide(game) {
  return {
    embeds: [
      embed(config.color.info)
        .setTitle(`🤝 Looking for group — ${game}`)
        .setDescription(
          'Post like this:\n```\nRank / level:\nRegion / server:\nMode (ranked / unrated / customs):\nNeed: 1 / 2 / 3 players\nMic: yes / no\n```\nThen hop into a Squad voice channel.',
        ),
    ],
  };
}

function staffGuide() {
  return {
    embeds: [
      embed(config.color.info)
        .setTitle('🛡️ King A — staff cheat sheet')
        .setDescription(
          [
            '**Talk to me in plain words.** Mention me and say what you want:',
            '> @King A remove @someone for spamming',
            '> @King A create a text channel called tournament-chat in Events',
            '> @King A give @someone the Helper role',
            '> @King A sort the channels in Lounge',
            '> @King A lock general for 10 minutes',
            'Risky actions (kick, ban, delete) ask for a confirm click first.',
            '',
            '**Slash commands:** `/mod` (kick, ban, tempban, softban, timeout, warn, purge…), `/channel`, `/channelrule`, `/role`, `/giveaway`, `/banter pause|resume`, `/announce`, `/award`, `/setup`.',
            '**Member reports** land in the reports channel with action buttons.',
            '',
            '**Banter kill switch:** `/banter pause` stops all of King A\'s chatting instantly. Everything it says is logged in bot-logs.',
          ].join('\n'),
        ),
    ],
  };
}

function gamesGuide() {
  return {
    embeds: [
      embed(config.color.purple)
        .setTitle('🕹️ Arcade')
        .setDescription(
          [
            '🟩 `/wordle daily` — same word for the whole server, once a day. Keep your streak!',
            '🟨 `/wordle practice` — unlimited games',
            '🧠 `/trivia` — gaming & gear trivia, first right answer earns XP',
            '🤔 `/wyr` — would you rather, everyone votes',
            '✊ `/rps` — rock paper scissors vs King A or a friend',
            '🎣 `/fish cast` — head to the fishing channel',
            '💰 `/daily` — free coins every day, bigger with a streak',
            '📊 `/rank` and `/leaderboard` — flex your level',
          ].join('\n'),
        ),
    ],
  };
}

function fishingGuide() {
  return {
    embeds: [
      embed(0x1f8acb)
        .setTitle('🎣 Welcome to the Docks')
        .setDescription(
          [
            '`/fish cast` — throw your line. When you see **BITE!**, smash **Reel!** fast.',
            '`/fish bag` — see your catch',
            '`/fish sell` — sell everything for coins',
            '`/fish shop` / `/fish buy` — better rods = rarer fish + more reaction time',
            '`/fish travel` — new waters with new fish (some need a better rod)',
            '`/fish index` — how many species you\'ve discovered',
            '',
            'Rarities: ⚪ Common · 🟢 Uncommon · 🔵 Rare · 🟣 Epic · 🟠 Legendary · 🔴 Mythic',
          ].join('\n'),
        ),
    ],
  };
}

function roleRefreshRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sr:mine').setLabel('Show my roles').setEmoji('🪪').setStyle(ButtonStyle.Secondary),
  );
}

module.exports = {
  rulesEmbeds,
  aboutEmbeds,
  selfRolesPanel,
  introTemplate,
  welcomeHeader,
  lfgGuide,
  staffGuide,
  gamesGuide,
  fishingGuide,
  roleRefreshRow,
};
