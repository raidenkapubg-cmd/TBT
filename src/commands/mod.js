const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const config = require('../config');
const store = require('../store');
const actions = require('../features/actions');
const { embed, log } = require('../util/helpers');

const P = PermissionFlagsBits;

async function runAction(i, action, { ephemeral = false } = {}) {
  try {
    const result = await actions.run(i.member, action);
    await log(i.guild, 'server_logs', { embeds: [embed(config.color.info).setDescription(`${result}\n*by ${i.user.tag} via /${i.commandName}*`)] });
    return i.reply({ content: result, flags: ephemeral ? MessageFlags.Ephemeral : undefined, allowedMentions: { parse: [] } });
  } catch (err) {
    return i.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
  }
}

const mod = {
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation tools')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addSubcommand((s) => s.setName('kick').setDescription('Kick a member').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Why')))
    .addSubcommand((s) =>
      s.setName('ban').setDescription('Ban a member').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Why'))
        .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete their messages from the last N days (0-7)').setMinValue(0).setMaxValue(7)),
    )
    .addSubcommand((s) => s.setName('unban').setDescription('Unban by user ID').addStringOption((o) => o.setName('user_id').setDescription('User ID').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('timeout').setDescription('Timeout (mute) a member').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addIntegerOption((o) => o.setName('minutes').setDescription('How long').setRequired(true).setMinValue(1).setMaxValue(40320)).addStringOption((o) => o.setName('reason').setDescription('Why')),
    )
    .addSubcommand((s) => s.setName('untimeout').setDescription('Remove a timeout').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
    .addSubcommand((s) => s.setName('warn').setDescription('Warn a member (DMs them)').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true)))
    .addSubcommand((s) => s.setName('warnings').setDescription('See a member\'s warnings').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('purge').setDescription('Bulk-delete recent messages here').addIntegerOption((o) => o.setName('count').setDescription('How many (max 100)').setRequired(true).setMinValue(1).setMaxValue(100))
        .addUserOption((o) => o.setName('user').setDescription('Only messages from this user')),
    )
    .addSubcommand((s) => s.setName('nick').setDescription('Change a nickname').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addStringOption((o) => o.setName('nickname').setDescription('New nickname (empty = reset)'))),
  async execute(i) {
    const sub = i.options.getSubcommand();
    const user = i.options.getUser('user');
    const reason = i.options.getString('reason') || undefined;
    if (sub === 'kick') return runAction(i, { type: 'kick', user: user.id, reason });
    if (sub === 'ban') return runAction(i, { type: 'ban', user: user.id, reason, delete_days: i.options.getInteger('delete_days') || 0 });
    if (sub === 'unban') return runAction(i, { type: 'unban', user_id: i.options.getString('user_id') });
    if (sub === 'timeout') return runAction(i, { type: 'timeout', user: user.id, minutes: i.options.getInteger('minutes'), reason });
    if (sub === 'untimeout') return runAction(i, { type: 'untimeout', user: user.id });
    if (sub === 'warn') return runAction(i, { type: 'warn', user: user.id, reason });
    if (sub === 'nick') return runAction(i, { type: 'nick', user: user.id, nickname: i.options.getString('nickname') });
    if (sub === 'purge') return runAction(i, { type: 'purge', channel: i.channel.id, count: i.options.getInteger('count'), user: user?.id }, { ephemeral: true });
    if (sub === 'warnings') {
      const warns = store.user(i.guild.id, user.id).warns || [];
      return i.reply({
        embeds: [
          embed(config.color.warn)
            .setTitle(`⚠️ Warnings for ${user.tag}`)
            .setDescription(warns.length ? warns.map((w, n) => `**${n + 1}.** ${w.reason} — <@${w.by}> <t:${Math.floor(w.at / 1000)}:R>`).join('\n') : 'Clean record ✨'),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

const channelCmd = {
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Manage channels')
    .setDefaultMemberPermissions(P.ManageChannels)
    .addSubcommand((s) =>
      s.setName('create').setDescription('Create a channel').addStringOption((o) => o.setName('name').setDescription('Name').setRequired(true))
        .addStringOption((o) => o.setName('type').setDescription('Type').addChoices({ name: 'Text', value: 'text' }, { name: 'Voice', value: 'voice' }, { name: 'Category', value: 'category' }))
        .addChannelOption((o) => o.setName('category').setDescription('Put it in this category').addChannelTypes(ChannelType.GuildCategory))
        .addBooleanOption((o) => o.setName('private').setDescription('Hide from everyone')),
    )
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a channel').addChannelOption((o) => o.setName('channel').setDescription('Which').setRequired(true)))
    .addSubcommand((s) => s.setName('rename').setDescription('Rename a channel').addChannelOption((o) => o.setName('channel').setDescription('Which').setRequired(true)).addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('move').setDescription('Move a channel into a category').addChannelOption((o) => o.setName('channel').setDescription('Which').setRequired(true))
        .addChannelOption((o) => o.setName('category').setDescription('Into').setRequired(true).addChannelTypes(ChannelType.GuildCategory)),
    )
    .addSubcommand((s) => s.setName('sort').setDescription('Sort channels A→Z (text first, then voice)').addChannelOption((o) => o.setName('category').setDescription('Only this category').addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand((s) => s.setName('lock').setDescription('Lock a channel').addChannelOption((o) => o.setName('channel').setDescription('Which (default: here)')).addIntegerOption((o) => o.setName('minutes').setDescription('Auto-unlock after')))
    .addSubcommand((s) => s.setName('unlock').setDescription('Unlock a channel').addChannelOption((o) => o.setName('channel').setDescription('Which (default: here)')))
    .addSubcommand((s) => s.setName('slowmode').setDescription('Set slowmode').addIntegerOption((o) => o.setName('seconds').setDescription('0 = off').setRequired(true).setMinValue(0).setMaxValue(21600)).addChannelOption((o) => o.setName('channel').setDescription('Which (default: here)'))),
  async execute(i) {
    const sub = i.options.getSubcommand();
    const ch = i.options.getChannel('channel') || i.channel;
    const cat = i.options.getChannel('category');
    if (sub === 'create') return runAction(i, { type: 'create_channel', name: i.options.getString('name'), kind: i.options.getString('type') || 'text', category: cat?.id, private: i.options.getBoolean('private') });
    if (sub === 'delete') return runAction(i, { type: 'delete_channel', channel: ch.id }, { ephemeral: true });
    if (sub === 'rename') return runAction(i, { type: 'rename_channel', channel: ch.id, name: i.options.getString('name') });
    if (sub === 'move') return runAction(i, { type: 'move_channel', channel: ch.id, category: cat.id });
    if (sub === 'sort') return runAction(i, { type: 'sort_channels', category: cat?.id });
    if (sub === 'lock') return runAction(i, { type: 'lock', channel: ch.id, minutes: i.options.getInteger('minutes') });
    if (sub === 'unlock') return runAction(i, { type: 'unlock', channel: ch.id });
    if (sub === 'slowmode') return runAction(i, { type: 'slowmode', channel: ch.id, seconds: i.options.getInteger('seconds') });
  },
};

const roleCmd = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Manage roles')
    .setDefaultMemberPermissions(P.ManageRoles)
    .addSubcommand((s) => s.setName('add').setDescription('Give a role').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Take a role').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('create').setDescription('Create a role').addStringOption((o) => o.setName('name').setDescription('Name').setRequired(true))
        .addStringOption((o) => o.setName('color').setDescription('Hex like #ff0000 or a name like red')).addBooleanOption((o) => o.setName('hoist').setDescription('Show separately in member list')),
    )
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a role').addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))),
  async execute(i) {
    const sub = i.options.getSubcommand();
    const user = i.options.getUser('user');
    const role = i.options.getRole('role');
    if (sub === 'add') return runAction(i, { type: 'add_role', user: user.id, role: role.id });
    if (sub === 'remove') return runAction(i, { type: 'remove_role', user: user.id, role: role.id });
    if (sub === 'create') return runAction(i, { type: 'create_role', name: i.options.getString('name'), color: i.options.getString('color'), hoist: i.options.getBoolean('hoist') });
    if (sub === 'delete') return runAction(i, { type: 'delete_role', role: role.id });
  },
};

const announce = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post an announcement embed')
    .setDefaultMemberPermissions(P.ManageGuild)
    .addStringOption((o) => o.setName('message').setDescription('Text (use \\n for new lines)').setRequired(true))
    .addStringOption((o) => o.setName('title').setDescription('Title'))
    .addChannelOption((o) => o.setName('channel').setDescription('Where (default: announcements)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption((o) => o.setName('ping').setDescription('Role to ping')),
  async execute(i) {
    return runAction(
      i,
      {
        type: 'announce',
        channel: i.options.getChannel('channel')?.id,
        title: i.options.getString('title'),
        message: i.options.getString('message').replace(/\\n/g, '\n'),
        ping_role: i.options.getRole('ping')?.id,
      },
      { ephemeral: true },
    );
  },
};

module.exports = { commands: [mod, channelCmd, roleCmd, announce] };
