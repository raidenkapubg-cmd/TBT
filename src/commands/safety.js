const {
  SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags,
} = require('discord.js');
const config = require('../config');
const store = require('../store');
const guard = require('../features/guard');
const levels = require('../features/levels');
const { embed, channel, role } = require('../util/helpers');

const P = PermissionFlagsBits;
const reportCooldown = new Map();

function cooldownLeft(userId) {
  const left = 60000 - (Date.now() - (reportCooldown.get(userId) || 0));
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// ---------------------------------------------------------------- member reports
const report = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report someone to the staff (only staff see it)')
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('What happened').setRequired(true).setMaxLength(500)),
  async execute(i) {
    const left = cooldownLeft(i.user.id);
    if (left) return i.reply({ content: `⏳ Please wait ${left}s before reporting again.`, flags: MessageFlags.Ephemeral });
    const target = await i.guild.members.fetch(i.options.getUser('user').id).catch(() => null);
    if (!target) return i.reply({ content: 'That person isn\'t in the server.', flags: MessageFlags.Ephemeral });
    if (target.id === i.user.id) return i.reply({ content: 'You can\'t report yourself 😅', flags: MessageFlags.Ephemeral });
    reportCooldown.set(i.user.id, Date.now());
    await guard.reportCard(i.guild, { title: '🚩 Member report', target, text: i.options.getString('reason'), by: `${i.user.tag}` });
    return i.reply({ content: '✅ Sent to the staff privately. Thanks for looking out! 🛡️', flags: MessageFlags.Ephemeral });
  },
};

const reportMessage = {
  data: new ContextMenuCommandBuilder().setName('Report message').setType(ApplicationCommandType.Message),
  async execute(i) {
    const left = cooldownLeft(i.user.id);
    if (left) return i.reply({ content: `⏳ Please wait ${left}s before reporting again.`, flags: MessageFlags.Ephemeral });
    const msg = i.targetMessage;
    const modal = new ModalBuilder()
      .setCustomId(`repmsg:${msg.channelId}:${msg.id}`)
      .setTitle('Report message')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reason').setLabel('What\'s wrong with it?').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false),
        ),
      );
    return i.showModal(modal);
  },
};

async function onReportMessageModal(i) {
  const [, channelId, messageId] = i.customId.split(':');
  const ch = i.guild.channels.cache.get(channelId);
  const msg = await ch?.messages.fetch(messageId).catch(() => null);
  if (!msg) return i.reply({ content: 'That message is gone already.', flags: MessageFlags.Ephemeral });
  const target = await i.guild.members.fetch(msg.author.id).catch(() => null);
  if (!target) return i.reply({ content: 'That person already left.', flags: MessageFlags.Ephemeral });
  reportCooldown.set(i.user.id, Date.now());
  const reason = i.fields.getTextInputValue('reason') || 'No reason given';
  await guard.reportCard(i.guild, {
    title: '🚩 Message report',
    target,
    text: `**Reason:** ${reason}\n**Message:**\n> ${(msg.content || '[attachment]').slice(0, 800)}`,
    by: i.user.tag,
    messageUrl: msg.url,
  });
  return i.reply({ content: '✅ Reported to the staff privately. Thanks! 🛡️', flags: MessageFlags.Ephemeral });
}

// ---------------------------------------------------------------- console
const consoleCmd = {
  data: new SlashCommandBuilder()
    .setName('console')
    .setDescription('Create (or find) the private King A console channel')
    .setDefaultMemberPermissions(P.Administrator),
  async execute(i) {
    const existing = channel(i.guild, 'console');
    if (existing && store.guild(i.guild.id).channels.console === existing.id) {
      return i.reply({ content: `👑 Your console is ${existing}. Just type in it — no @ needed.`, flags: MessageFlags.Ephemeral });
    }
    const staffCat = channel(i.guild, 'cat_staff');
    const staffRoles = ['admin', 'mod'].map((k) => role(i.guild, k)).filter(Boolean);
    const ch = await i.guild.channels.create({
      name: '👑・king-a-console',
      type: ChannelType.GuildText,
      parent: staffCat?.id,
      topic: 'Talk to King A in plain English. No @ needed.',
      permissionOverwrites: [
        { id: i.guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: i.guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks] },
        { id: i.user.id, allow: [P.ViewChannel, P.SendMessages] },
        ...staffRoles.map((r) => ({ id: r.id, allow: [P.ViewChannel, P.SendMessages] })),
      ],
    });
    store.guild(i.guild.id).channels.console = ch.id;
    store.markDirty();
    await ch.send(consoleWelcome());
    return i.reply({ content: `👑 Created ${ch}. Just type in it — no @ needed.`, flags: MessageFlags.Ephemeral });
  },
};

function consoleWelcome() {
  return {
    embeds: [
      embed(config.color.main)
        .setTitle('👑 King A Console')
        .setDescription(
          [
            'Type what you want in plain English (Hinglish works too). No @ needed. I remember the last few messages, so follow-ups like "now make it private" work.',
            '',
            '**Try things like:**',
            '> make a channel called dont-post-here that bans anyone who posts for 7 days',
            '> create a media-only channel called memes-only in Lounge with 👍 and 😂 auto reactions',
            '> let only Regulars send messages in general, everyone else read-only',
            '> make a level 25 role called Grinder in orange',
            '> give @someone 500 xp',
            '> tempban @someone 3 days for scam links',
            '> rename the server to Something Cool and set verification to high',
            '> server report / report on @someone / show channel rules',
            '',
            'Kicks, bans, deletes and big changes ask for a ✅ confirm first. Everything I do is logged in server-logs.',
          ].join('\n'),
        ),
    ],
  };
}

// ---------------------------------------------------------------- channel rules
const ruleChoices = Object.entries(guard.RULES).map(([k, v]) => ({ name: v.label, value: k }));
const channelRule = {
  data: new SlashCommandBuilder()
    .setName('channelrule')
    .setDescription('Give a channel special behaviour')
    .setDefaultMemberPermissions(P.ManageChannels)
    .addSubcommand((s) =>
      s.setName('set').setDescription('Add a rule to a channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Which channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName('rule').setDescription('Rule').setRequired(true).addChoices(...ruleChoices))
        .addStringOption((o) => o.setName('action').setDescription('Trap: what happens to posters').addChoices(
          { name: 'Temp ban (default 7 days)', value: 'tempban' }, { name: 'Soft ban (kick + wipe msgs)', value: 'softban' },
          { name: 'Kick', value: 'kick' }, { name: 'Ban forever', value: 'ban' }, { name: 'Timeout', value: 'timeout' }))
        .addIntegerOption((o) => o.setName('days').setDescription('Trap temp ban length').setMinValue(1).setMaxValue(365))
        .addIntegerOption((o) => o.setName('minutes').setDescription('Trap timeout length').setMinValue(1).setMaxValue(40320))
        .addIntegerOption((o) => o.setName('seconds').setDescription('Auto-delete after').setMinValue(3).setMaxValue(86400))
        .addIntegerOption((o) => o.setName('level').setDescription('Level gate: minimum level').setMinValue(1))
        .addStringOption((o) => o.setName('emojis').setDescription('Auto-react: emojis separated by spaces')),
    )
    .addSubcommand((s) =>
      s.setName('clear').setDescription('Remove rules from a channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Which channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName('rule').setDescription('Only this rule').addChoices(...ruleChoices)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show every channel rule')),
  async execute(i) {
    const sub = i.options.getSubcommand();
    const actions = require('../features/actions');
    try {
      if (sub === 'list') {
        const lines = guard.listRules(i.guild);
        return i.reply({ content: lines.length ? lines.join('\n').slice(0, 1900) : 'No channel rules yet.', flags: MessageFlags.Ephemeral });
      }
      const ch = i.options.getChannel('channel');
      if (sub === 'clear') {
        const res = await actions.run(i.member, { type: 'clear_channel_rules', channel: ch.id, rule: i.options.getString('rule') || undefined });
        return i.reply({ content: res, flags: MessageFlags.Ephemeral });
      }
      const a = { type: 'set_channel_rule', channel: ch.id, rule: i.options.getString('rule') };
      for (const k of ['action', 'emojis']) if (i.options.getString(k)) a[k] = i.options.getString(k);
      for (const k of ['days', 'minutes', 'seconds', 'level']) if (i.options.getInteger(k)) a[k] = i.options.getInteger(k);
      return i.reply({ content: await actions.run(i.member, a), flags: MessageFlags.Ephemeral });
    } catch (err) {
      return i.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  },
};

// ---------------------------------------------------------------- level ladder
const levelsCmd = {
  data: new SlashCommandBuilder().setName('levels').setDescription('See the level roles and how XP works'),
  async execute(i) {
    const steps = levels.ladder(i.guild);
    const myLevel = store.user(i.guild.id, i.user.id).level;
    return i.reply({
      embeds: [
        embed(config.color.purple)
          .setTitle('🪜 Level roles')
          .setDescription(
            [
              steps.map((s) => `${myLevel >= s.level ? '✅' : '🔒'} **Level ${s.level}** → <@&${s.roleId}>`).join('\n') || 'No level roles set up yet.',
              `\n🌟 Level ${config.levels.insiderLevel} also unlocks the **Insiders** area.`,
              '',
              '**How XP works**',
              '• Chat normally: 15–25 XP per message (+ a bit more for longer messages), max once a minute',
              '• Spam earns **nothing**: short messages, repeated messages, "aaaaa", or 5+ messages in 10s (that also pauses your XP for 5 min)',
              '• Bonus XP from trivia, chat games, daily rewards, hall of fame and events',
              '• You keep only your highest level role',
            ].join('\n'),
          )
          .setFooter({ text: `You're level ${myLevel}` }),
      ],
      allowedMentions: { parse: [] },
    });
  },
};

module.exports = {
  commands: [report, reportMessage, consoleCmd, channelRule, levelsCmd],
  components: { repmsg: onReportMessageModal },
  consoleWelcome,
};
