const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config');
const tpl = require('../setup/template');
const { runSetup } = require('../setup/runner');
const { embed, channel } = require('../util/helpers');

let running = new Set();

function preview(fresh) {
  const cats = tpl.categories.map((c) => `**${c.name}** — ${c.channels.length} channels${c.access?.roles ? ' *(opt-in)*' : c.access === 'staff' ? ' *(staff only)*' : ''}`);
  const selfRoles = tpl.selfRoleCategories.length;
  const roleCount = tpl.roles.length + tpl.selfRoleCategories.reduce((n, c) => n + c.options.length, 0);
  return embed(fresh ? config.color.bad : config.color.warn)
    .setTitle(fresh ? '🏗️ Fresh setup — this WIPES the server' : '🏗️ Setup — add what\'s missing')
    .setDescription(
      [
        fresh
          ? '⚠️ **Every existing channel and role that isn\'t part of the template will be deleted.** Messages in deleted channels are gone forever.'
          : 'Existing channels and roles are kept. Anything from the template that\'s missing gets created, and matching ones get their permissions fixed.',
        '',
        ...cats,
        '',
        `🎭 ${roleCount} roles (staff, levels, awards + ${selfRoles} self-role menus)`,
        '📜 Rules, about, self-roles panel, LFG guides and staff cheat sheet get posted',
        '⚙️ Verification: Medium · AutoMod: slurs/sexual content/mention spam · AFK channel',
      ].join('\n'),
    );
}

const setup = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Build the whole server from King A\'s template')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('mode').setDescription('How to build').addChoices(
        { name: 'Fresh — wipe everything and rebuild', value: 'fresh' },
        { name: 'Add — keep existing stuff, add what\'s missing', value: 'add' },
      ),
    ),
  async execute(i) {
    if (!i.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return i.reply({ content: 'Only admins can run setup.', flags: MessageFlags.Ephemeral });
    }
    if (!i.guild.members.me.permissions.has(PermissionFlagsBits.Administrator)) {
      return i.reply({ content: '❌ I need the **Administrator** permission to build the server.', flags: MessageFlags.Ephemeral });
    }
    const fresh = (i.options.getString('mode') || 'fresh') === 'fresh';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:go:${fresh ? 'fresh' : 'add'}`).setLabel(fresh ? 'Wipe & build' : 'Build').setEmoji('🏗️').setStyle(fresh ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('setup:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return i.reply({ embeds: [preview(fresh)], components: [row], flags: MessageFlags.Ephemeral });
  },
};

async function onSetup(interaction) {
  const [, action, mode] = interaction.customId.split(':');
  if (action === 'cancel') return interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only admins can run setup.', flags: MessageFlags.Ephemeral });
  }
  if (running.has(interaction.guild.id)) return interaction.reply({ content: 'Setup is already running!', flags: MessageFlags.Ephemeral });
  running.add(interaction.guild.id);

  const fresh = mode === 'fresh';
  await interaction.update({ content: '🏗️ Starting…', embeds: [], components: [] });
  const progress = async (text) => {
    await interaction.editReply({ content: text }).catch(() => {});
  };

  try {
    const report = await runSetup(interaction.guild, { fresh, onProgress: progress });
    const summary = embed(config.color.good)
      .setTitle('✅ Server built!')
      .setDescription(
        [
          `🎭 Roles created: **${report.rolesCreated}**${fresh ? ` · removed: **${report.rolesDeleted}**` : ''}`,
          `📁 Channels created: **${report.channelsCreated}**${fresh ? ` · removed: **${report.channelsDeleted}**` : ''}`,
          report.warnings.length ? `\n⚠️ **Warnings**\n${report.warnings.slice(0, 10).map((w) => `• ${w}`).join('\n')}` : '',
          '',
          '**Next steps**',
          '• Give your staff the 🛡️ Moderator / 💡 Helper / 🤝 Welcome Squad roles',
          '• Turn on Community in Server Settings to unlock Onboarding, announcement channels & Discovery',
          '• Try `@King A` + a request in mod-chat, e.g. "lock general for 5 minutes"',
        ].join('\n'),
      );
    await interaction.editReply({ content: '', embeds: [summary] }).catch(async () => {
      // The channel we were replying in may have been deleted (fresh mode) — post in mod-chat instead.
      const modChat = channel(interaction.guild, 'mod_chat');
      if (modChat) await modChat.send({ content: `<@${interaction.user.id}>`, embeds: [summary] }).catch(() => {});
    });
  } catch (err) {
    console.error('[setup]', err);
    const modChat = channel(interaction.guild, 'mod_chat');
    const text = `❌ Setup stopped: ${err.message}\nYou can run \`/setup mode:Add\` to continue where it stopped.`;
    await interaction.editReply({ content: text }).catch(() => modChat?.send(text).catch(() => {}));
  } finally {
    running.delete(interaction.guild.id);
  }
}

module.exports = { commands: [setup], components: { setup: onSetup } };
