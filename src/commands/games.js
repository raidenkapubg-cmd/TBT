// /play and /activity: start Discord's built-in Activities in a voice channel.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const config = require('../config');
const store = require('../store');
const activities = require('../features/activities');
const { embed } = require('../util/helpers');

async function autocomplete(i) {
  const q = i.options.getFocused().toLowerCase();
  const all = activities.list(i.guild.id).filter((a) => !q || a.name.toLowerCase().includes(q));
  await i.respond(all.slice(0, 25).map((a) => ({ name: `${a.emoji || '🎮'} ${a.name}${a.legacy ? ' (may be retired)' : ''}`.slice(0, 100), value: a.key })));
}

const play = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Start a Discord Activity (built-in game) in a voice channel')
    .addStringOption((o) => o.setName('game').setDescription('Which game').setRequired(true).setAutocomplete(true))
    .addChannelOption((o) => o.setName('voice').setDescription('Voice channel (default: the one you\'re in)').addChannelTypes(ChannelType.GuildVoice)),
  autocomplete,
  async execute(i) {
    await i.deferReply();
    try {
      const res = await activities.launch(i.guild, i.member, i.options.getString('game'), i.options.getChannel('voice'));
      await i.editReply(activities.launchMessage(res, i.user.id));
    } catch (err) {
      await i.editReply({ content: `❌ ${err.message}` });
    }
  },
};

const activityCmd = {
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('Manage the list of games King A can launch')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('add').setDescription('Add a Discord Activity by its application ID')
        .addStringOption((o) => o.setName('name').setDescription('Name, e.g. Wordle').setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName('id').setDescription('Application ID (from its App Directory page URL)').setRequired(true))
        .addStringOption((o) => o.setName('emoji').setDescription('An emoji for the menu'))
        .addStringOption((o) => o.setName('description').setDescription('Short description').setMaxLength(90)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a custom game').addStringOption((o) => o.setName('game').setDescription('Which').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Show every game')),
  autocomplete,
  async execute(i) {
    const sub = i.options.getSubcommand();
    const g = store.guild(i.guild.id);
    g.customActivities = g.customActivities || {};
    if (sub === 'add') {
      const id = i.options.getString('id').match(/\d{17,20}/)?.[0];
      if (!id) return i.reply({ content: '❌ That doesn\'t look like an application ID (17–20 digits). Open the game in the App Directory — the number in the page URL is the ID.', flags: MessageFlags.Ephemeral });
      const name = i.options.getString('name');
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || id;
      g.customActivities[key] = { name, id, emoji: i.options.getString('emoji') || '🎮', desc: i.options.getString('description') || '' };
      store.markDirty();
      return i.reply({ content: `✅ Added **${name}**. Try it with \`/play game:${name}\`. Run \`/setup mode:Add\` to refresh the Game Room menu.`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'remove') {
      const key = i.options.getString('game');
      if (!g.customActivities[key]) return i.reply({ content: 'Only games you added yourself can be removed.', flags: MessageFlags.Ephemeral });
      delete g.customActivities[key];
      store.markDirty();
      return i.reply({ content: '🗑️ Removed.', flags: MessageFlags.Ephemeral });
    }
    const all = activities.list(i.guild.id);
    return i.reply({
      embeds: [
        embed(config.color.purple)
          .setTitle(`🕹️ ${all.length} games`)
          .setDescription(all.map((a) => `${a.emoji || '🎮'} **${a.name}**${a.custom ? ' *(added by staff)*' : ''}${a.legacy ? ' *(may be retired)*' : ''} — \`${a.id}\``).join('\n').slice(0, 4000)),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};

module.exports = { commands: [play, activityCmd] };
