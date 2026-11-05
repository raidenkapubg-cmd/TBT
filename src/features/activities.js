// Launch Discord's built-in Activities (the 🚀 games in voice channels) from a button or a command.
// The bot creates a voice-channel invite that opens the activity; whoever clicks it joins the VC and the game.
const {
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, InviteTargetType, MessageFlags,
} = require('discord.js');
const config = require('../config');
const store = require('../store');
const { embed, channel } = require('../util/helpers');

// IDs from Discord's own Activities (source: the discord-together package, v1.4.2).
// Discord adds and retires activities over time; staff can add more by ID with /activity add.
const BUILT_IN = [
  { key: 'youtube', name: 'Watch Together', emoji: '📺', id: '880218394199220334', desc: 'Watch YouTube together' },
  { key: 'puttparty', name: 'Putt Party', emoji: '⛳', id: '763133495793942528', desc: 'Chaotic mini golf' },
  { key: 'sketchheads', name: 'Sketch Heads', emoji: '🎨', id: '902271654783242291', desc: 'Draw & guess' },
  { key: 'spellcast', name: 'SpellCast', emoji: '🔮', id: '852509694341283871', desc: 'Word battle on a magic grid' },
  { key: 'lettertile', name: 'Letter League', emoji: '🔠', id: '879863686565621790', desc: 'Scrabble-style word game' },
  { key: 'wordsnack', name: 'Word Snacks', emoji: '🥨', id: '879863976006127627', desc: 'Quick-fire word finding' },
  { key: 'poker', name: 'Poker Night', emoji: '🃏', id: '755827207812677713', desc: 'Texas hold \'em (no real money)' },
  { key: 'ocho', name: 'Blazing 8s', emoji: '🔥', id: '832025144389533716', desc: 'Crazy-eights card game' },
  { key: 'chess', name: 'Chess in the Park', emoji: '♟️', id: '832012774040141894', desc: 'Chess' },
  { key: 'checkers', name: 'Checkers in the Park', emoji: '🔴', id: '832013003968348200', desc: 'Checkers' },
  { key: 'land', name: 'Land-io', emoji: '🗺️', id: '903769130790969345', desc: 'Claim territory, cut off rivals' },
  { key: 'bobble', name: 'Bobble League', emoji: '⚽', id: '947957217959759964', desc: 'Turn-based football' },
  { key: 'meme', name: 'Know What I Meme', emoji: '😂', id: '950505761862189096', desc: 'Caption memes, vote the best' },
  { key: 'askaway', name: 'Ask Away', emoji: '❓', id: '976052223358406656', desc: 'Get-to-know-you questions' },
  { key: 'bashout', name: 'Bash Out', emoji: '💥', id: '1006584476094177371', desc: 'Party brawler' },
  // Older activities Discord may have retired — kept so you can try them
  { key: 'fishing', name: 'Fishington', emoji: '🎣', id: '814288819477020702', desc: 'Chill multiplayer fishing (may be retired)', legacy: true },
  { key: 'betrayal', name: 'Betrayal', emoji: '🔪', id: '773336526917861400', desc: 'Social deduction (may be retired)', legacy: true },
  { key: 'doodlecrew', name: 'Doodle Crew', emoji: '🖍️', id: '878067389634314250', desc: 'Drawing game (may be retired)', legacy: true },
  { key: 'awkword', name: 'Awkword', emoji: '💬', id: '879863881349087252', desc: 'Sentence-building party game (may be retired)', legacy: true },
];

function list(guildId) {
  const custom = Object.entries(store.guild(guildId).customActivities || {}).map(([key, a]) => ({ key, ...a, custom: true }));
  // Custom entries override built-ins with the same key
  return [...custom, ...BUILT_IN.filter((b) => !custom.some((c) => c.key === b.key))];
}

function find(guildId, query) {
  const q = String(query || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const all = list(guildId);
  return (
    all.find((a) => a.key === q || a.id === q) ||
    all.find((a) => a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === q) ||
    all.find((a) => a.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q) && q.length >= 3) ||
    null
  );
}

/** Pick the voice channel: the member's current one, else the first empty-ish Game Room, else any voice channel. */
function pickVoice(guild, member) {
  if (member?.voice?.channel) return member.voice.channel;
  const g = store.guild(guild.id);
  for (const k of ['game_room_1', 'game_room_2', 'hangout']) {
    const ch = guild.channels.cache.get(g.channels[k]);
    if (ch) return ch;
  }
  return guild.channels.cache.find((c) => c.type === ChannelType.GuildVoice) || null;
}

/** Creates the activity invite. Returns { url, voice, activity } or throws a friendly Error. */
async function launch(guild, member, query, voiceRef) {
  const activity = typeof query === 'object' ? query : find(guild.id, query);
  if (!activity) throw new Error(`I don't know a game called "${query}". Try \`/play\` and pick from the list, or add it with \`/activity add\`.`);
  const voice = voiceRef || pickVoice(guild, member);
  if (!voice || voice.type !== ChannelType.GuildVoice) throw new Error('I need a voice channel to start the game in.');
  try {
    const invite = await voice.createInvite({
      targetType: InviteTargetType.EmbeddedApplication,
      targetApplication: activity.id,
      maxAge: 4 * 3600,
      maxUses: 0,
      unique: true,
      reason: `Activity launched by ${member?.user?.tag || 'King A'}`,
    });
    return { url: invite.url, voice, activity };
  } catch (err) {
    throw new Error(
      `Discord wouldn't start **${activity.name}** from a link (${err.message}). It may have been retired, or Discord may not allow bots to launch it. ` +
        `You can still start it yourself: join ${voice}, click the 🚀 **Activities** button and pick the game.`,
    );
  }
}

function launchMessage({ url, voice, activity }, by) {
  return {
    embeds: [
      embed(config.color.purple)
        .setTitle(`${activity.emoji || '🎮'} ${activity.name} is starting!`)
        .setDescription(`${activity.desc ? `${activity.desc}\n\n` : ''}🔊 In ${voice}${by ? ` · started by <@${by}>` : ''}\nClick **Join** to hop in — it opens the game right in the voice channel.`)
        .setFooter({ text: 'Link works for 4 hours' }),
    ],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Join ${activity.name}`).setEmoji('▶️').setURL(url))],
    allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------- launcher panel (posted by /setup)
function panel(guildId) {
  const all = list(guildId).slice(0, 25);
  return {
    embeds: [
      embed(config.color.purple)
        .setTitle('🕹️ Game Room')
        .setDescription(
          [
            'Play Discord\'s built-in games together — no downloads.',
            '',
            '**1.** Join a voice channel (or I\'ll use 🕹️ Game Room 1)',
            '**2.** Pick a game below',
            '**3.** Everyone clicks **Join** on the message I post',
            '',
            'You can also just click 🚀 **Activities** in any voice channel, or use `/play`.',
            '🟩 **Wordle:** type `/wordle` anywhere — it\'s Discord\'s official Wordle.',
          ].join('\n'),
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('act:pick')
          .setPlaceholder('🎮 Pick a game to start')
          .addOptions(all.map((a) => ({ label: a.name.slice(0, 100), value: a.key, description: (a.desc || '').slice(0, 100) || undefined, emoji: a.emoji || '🎮' }))),
      ),
    ],
  };
}

async function onPick(interaction) {
  const key = interaction.values?.[0];
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const res = await launch(interaction.guild, interaction.member, key);
    await interaction.channel.send(launchMessage(res, interaction.user.id));
    await interaction.editReply(`✅ Started **${res.activity.name}** in ${res.voice}. Hop in!`);
  } catch (err) {
    await interaction.editReply(`❌ ${err.message}`);
  }
}

module.exports = { BUILT_IN, list, find, launch, launchMessage, panel, pickVoice, components: { act: onPick } };
