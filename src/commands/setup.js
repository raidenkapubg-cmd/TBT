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

// ================================================================= /setup2 (reorganize, no wipe)
const { AttachmentBuilder } = require('discord.js');
const reorganize = require('../setup/reorganize');
const pending2 = new Map(); // token -> { opts, userId }

const splitNames = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

const setup2 = {
  data: new SlashCommandBuilder()
    .setName('setup2')
    .setDescription('Reorganize the server WITHOUT wiping: tidy existing channels, hide unused ones, add what\'s missing')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('mode').setDescription('What to do').addChoices(
        { name: 'Preview, then apply (default)', value: 'run' },
        { name: 'Undo the last /setup2', value: 'undo' },
      ),
    )
    .addStringOption((o) => o.setName('hide').setDescription('Extra channels to hide, comma separated (e.g. f1, type-rift-contest)'))
    .addStringOption((o) => o.setName('keep').setDescription('Channels to keep exactly as they are, comma separated'))
    .addIntegerOption((o) => o.setName('inactive_days').setDescription('Hide unmatched public channels quiet for this many days (default 14)').setMinValue(1).setMaxValue(365))
    .addBooleanOption((o) => o.setName('keep_names').setDescription('Don\'t rename matched channels (only move + fix permissions)')),
  async execute(i) {
    if (!i.memberPermissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'Only admins can run this.', flags: MessageFlags.Ephemeral });
    if (!i.guild.members.me.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ content: '❌ I need the **Administrator** permission.', flags: MessageFlags.Ephemeral });
    const mode = i.options.getString('mode') || 'run';
    const token = `${i.id}`;

    if (mode === 'undo') {
      const b = require('../store').guild(i.guild.id).setup2Backup;
      if (!b) return i.reply({ content: 'There\'s no /setup2 to undo.', flags: MessageFlags.Ephemeral });
      pending2.set(token, { undo: true, userId: i.user.id });
      return i.reply({
        embeds: [embed(config.color.warn).setTitle('↩️ Undo /setup2?').setDescription(`This puts back the names, categories and permissions of **${Object.keys(b.channels).length}** channels, un-hides archived ones, and deletes the **${b.createdChannels.length}** channels and **${b.createdRoles.length}** roles that /setup2 created (<t:${Math.floor(b.at / 1000)}:R>).`)],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`setup2:go:${token}`).setLabel('Undo').setEmoji('↩️').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`setup2:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    const opts = {
      hide: splitNames(i.options.getString('hide')),
      keep: splitNames(i.options.getString('keep')),
      inactiveDays: i.options.getInteger('inactive_days') ?? 14,
      keepNames: !!i.options.getBoolean('keep_names'),
    };
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await i.guild.channels.fetch();
    await i.guild.roles.fetch();
    const p = reorganize.plan(i.guild, opts);
    pending2.set(token, { opts, userId: i.user.id });
    setTimeout(() => pending2.delete(token), 15 * 60000).unref();
    const list = (arr, f, n = 8) => (arr.length ? arr.slice(0, n).map(f).join('\n') + (arr.length > n ? `\n…and ${arr.length - n} more` : '') : '—');
    const e = embed(config.color.info)
      .setTitle('🧭 /setup2 plan — nothing is wiped')
      .setDescription('Full list in the attached **plan.txt**. Not happy with it? Re-run with `hide:` / `keep:` / `keep_names:`. You can always `/setup2 mode:Undo`.')
      .addFields(
        { name: `✏️ Tidy & reuse (${p.reuse.length})`, value: list(p.reuse, (r) => `\`${r.ch.name}\` → \`${r.newName}\``).slice(0, 1024) },
        { name: `🗄️ Hide in archive (${p.hide.length})`, value: list(p.hide, (h) => `\`${h.ch.name}\` — ${h.why}`).slice(0, 1024) },
        { name: `📌 Keep as is (${p.keep.length})`, value: list(p.keep, (k) => `\`${k.ch.name}\` — ${k.why}`).slice(0, 1024) },
        { name: `➕ Create (${p.create.length} channels · ${p.catCreate.length} categories)`, value: list(p.create, (c) => `\`${c.spec.name}\``, 10).slice(0, 1024) },
        { name: '🎭 Roles', value: `Reuse **${p.roleReuse.length}** (left unchanged) · create **${p.roleCreate.length}**` },
      );
    const file = new AttachmentBuilder(Buffer.from(reorganize.planText(p), 'utf8'), { name: 'plan.txt' });
    return i.editReply({
      embeds: [e],
      files: [file],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup2:go:${token}`).setLabel('Apply').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`setup2:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      )],
    });
  },
};

async function onSetup2(interaction) {
  const [, action, token] = interaction.customId.split(':');
  const job = pending2.get(token);
  if (action === 'cancel') {
    pending2.delete(token);
    return interaction.update({ content: 'Cancelled.', embeds: [], components: [], files: [] });
  }
  if (!job) return interaction.reply({ content: 'This plan expired — run `/setup2` again.', flags: MessageFlags.Ephemeral });
  if (job.userId !== interaction.user.id) return interaction.reply({ content: 'Only the person who ran it can confirm.', flags: MessageFlags.Ephemeral });
  if (running.has(interaction.guild.id)) return interaction.reply({ content: 'A setup is already running!', flags: MessageFlags.Ephemeral });
  pending2.delete(token);
  running.add(interaction.guild.id);
  await interaction.update({ content: '⏳ Starting…', embeds: [], components: [], files: [] });
  const progress = (t) => interaction.editReply({ content: t }).catch(() => {});
  try {
    if (job.undo) {
      const r = await reorganize.undo(interaction.guild, progress);
      await interaction.editReply({ content: '', embeds: [embed(config.color.good).setTitle('↩️ Undone').setDescription(`Restored **${r.restored}** channels · removed **${r.deleted}** created channels · removed **${r.rolesDeleted}** created roles${r.warnings.length ? `\n\n⚠️ ${r.warnings.slice(0, 8).join('\n')}` : ''}`)] });
    } else {
      const { report: r } = await reorganize.apply(interaction.guild, job.opts, progress);
      await interaction.editReply({
        content: '',
        embeds: [embed(config.color.good).setTitle('✅ Server reorganized — nothing wiped').setDescription([
          `✏️ Tidied **${r.reused}** existing channels · ➕ created **${r.created}** · 🗄️ hid **${r.hidden}** · 📌 kept **${r.kept}** as is`,
          `🎭 Reused **${r.rolesReused}** roles · created **${r.rolesCreated}**${r.categoriesRemoved ? ` · removed ${r.categoriesRemoved} empty categories` : ''}`,
          r.warnings.length ? `\n⚠️ **Warnings**\n${r.warnings.slice(0, 8).map((w) => `• ${w}`).join('\n')}` : '',
          '',
          '• Hidden channels are in **🗄️ ARCHIVE** (staff can still see them). Move one back by dragging it, or `/setup2 mode:Undo`.',
          '• Your existing rules / self-roles channels were kept as they were. Run `/selfroles` there if you want King A\'s reaction-role panel.',
          '• If another bot also runs server-stats or welcome messages, remove it so they don\'t fight over the same channels.',
        ].filter(Boolean).join('\n'))],
      });
    }
  } catch (err) {
    console.error('[setup2]', err);
    await interaction.editReply({ content: `❌ Stopped: ${err.message}\nAnything already changed can be reverted with \`/setup2 mode:Undo\`.` }).catch(() => {});
  } finally {
    running.delete(interaction.guild.id);
  }
}

module.exports = { commands: [setup, setup2], components: { setup: onSetup, setup2: onSetup2 } };
