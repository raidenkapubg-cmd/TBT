const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const store = require('../store');
const tpl = require('../setup/template');
const { embed, role, channel, log } = require('../util/helpers');

/** Works out which roles to add/remove for a dropdown pick. Pure, for testing. */
function planSelect(cat, values, roleFor, has) {
  const add = [];
  const remove = [];
  const chosen = new Set(values);
  for (const o of cat.options) {
    const r = roleFor(o.key);
    if (!r) continue;
    const owned = has(r);
    if (cat.single) {
      if (chosen.has(o.key) && !owned) add.push(r);
      if (!chosen.has(o.key) && owned && chosen.size) remove.push(r);
    } else if (chosen.has(o.key)) {
      (owned ? remove : add).push(r);
    }
  }
  return { add, remove };
}

async function onSelect(interaction) {
  const catKey = interaction.customId.split(':')[1];

  if (catKey === 'mine') {
    const lines = tpl.selfRoleCategories.map((c) => {
      const have = c.options.filter((o) => {
        const r = role(interaction.guild, o.key);
        return r && interaction.member.roles.cache.has(r.id);
      });
      return `**${c.title}:** ${have.map((o) => o.name).join(', ') || '—'}`;
    });
    return interaction.reply({ embeds: [embed(config.color.purple).setTitle('🪪 Your character').setDescription(lines.join('\n'))], flags: MessageFlags.Ephemeral });
  }

  const cat = tpl.selfRoleCategories.find((c) => c.key === catKey);
  if (!cat) return interaction.reply({ content: 'This menu is outdated — ask staff to run `/selfroles`.', flags: MessageFlags.Ephemeral });

  // Discord resets a dropdown a moment after you pick, so each pick must NOT wipe the others.
  // Multi-pick menus toggle the picked roles; pick-one menus swap to the picked role.
  const { add, remove } = planSelect(cat, interaction.values, (key) => role(interaction.guild, key), (r) => interaction.member.roles.cache.has(r.id));
  try {
    if (add.length) await interaction.member.roles.add(add);
    if (remove.length) await interaction.member.roles.remove(remove);
  } catch {
    return interaction.reply({ content: '❌ I couldn\'t update your roles. Make sure my role is above the self-roles.', flags: MessageFlags.Ephemeral });
  }

  const quips = {
    team_pc: '🖥️ Welcome to the master race. Mobile players are typing a reply right now.',
    team_mobile: '📱 Thumbs of steel. PC players are already coping.',
    team_console: '🎮 Respect. Comfy couch gang.',
    team_swiss: '🏳️ Neutral? In THIS economy?',
    roast_me: '🔥 You chose violence. King A has been notified.',
    lurker: '👀 …we see you.',
    owner: `🔴 A ${config.brand} owner! Respect. Hit up product-talk and flex that gear.`,
    cable_chef: '🍝 Bon appétit.',
  };
  const quip = add.map((r) => quips[Object.entries(store.guild(interaction.guild.id).roles).find(([, id]) => id === r.id)?.[0]]).find(Boolean);

  const parts = [];
  if (add.length) parts.push(`➕ ${add.map((r) => r.name).join(', ')}`);
  if (remove.length) parts.push(`➖ ${remove.map((r) => r.name).join(', ')}`);
  if (!parts.length) parts.push('No changes.');
  parts.push('\n*Pick a role again to remove it.*');
  if (quip) parts.push(`\n${quip}`);
  if (catKey === 'games' && add.length) parts.push('\n🔓 New game channels unlocked — check the sidebar!');
  return interaction.reply({ content: parts.join('\n'), flags: MessageFlags.Ephemeral });
}

const selfroles = {
  data: new SlashCommandBuilder()
    .setName('selfroles')
    .setDescription('Re-post the self-roles panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  async execute(i) {
    const missing = tpl.selfRoleCategories.flatMap((c) => c.options).filter((o) => !role(i.guild, o.key));
    if (missing.length) return i.reply({ content: '❌ Self-roles don\'t exist yet — run `/setup` first (mode **Add** keeps your channels).', flags: MessageFlags.Ephemeral });
    await i.reply({ content: '⏳ Posting reaction roles…', flags: MessageFlags.Ephemeral });
    await require('../features/reactionroles').postPanels(i.channel);
    return i.editReply({ content: '✅ Posted. Delete the old panel if there was one.' });
  },
};

const AWARDS = {
  clip_week: { label: '🎬 Clip of the Week', xp: 150 },
  setup_month: { label: '🖥️ Setup of the Month', xp: 250 },
  skirmish_champ: { label: '🏆 Skirmish Champion', xp: 300 },
  biggest_l: { label: '🫠 Biggest L of the Week', xp: 50 },
  bot_slayer: { label: '🗡️ Bot Slayer', xp: 50 },
};

const award = {
  data: new SlashCommandBuilder()
    .setName('award')
    .setDescription('Give a community award (moves the role from the last winner)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption((o) => o.setName('award').setDescription('Which award').setRequired(true).addChoices(...Object.entries(AWARDS).map(([k, v]) => ({ name: v.label, value: k }))))
    .addUserOption((o) => o.setName('user').setDescription('Winner').setRequired(true))
    .addStringOption((o) => o.setName('note').setDescription('Why they won')),
  async execute(i) {
    const key = i.options.getString('award');
    const a = AWARDS[key];
    const r = role(i.guild, key);
    const member = await i.guild.members.fetch(i.options.getUser('user').id).catch(() => null);
    if (!r || !member) return i.reply({ content: '❌ Role or member not found. Has `/setup` been run?', flags: MessageFlags.Ephemeral });
    if (key !== 'bot_slayer' && key !== 'skirmish_champ') {
      for (const m of r.members.values()) if (m.id !== member.id) await m.roles.remove(r).catch(() => {});
    }
    await member.roles.add(r).catch(() => {});
    await require('../features/levels').addXp(member, a.xp, null);
    const note = i.options.getString('note');
    const e = embed(0xf1c40f)
      .setTitle(`${a.label}`)
      .setDescription(`Congrats <@${member.id}>! 🎉${note ? `\n> ${note}` : ''}\n\n**+${a.xp} XP**`)
      .setThumbnail(member.displayAvatarURL());
    const target = channel(i.guild, 'announcements') || i.channel;
    await target.send({ content: `<@${member.id}>`, embeds: [e] });
    await log(i.guild, 'server_logs', { content: `${a.label} → ${member.user.tag} (by ${i.user.tag})` });
    return i.reply({ content: `✅ Awarded in ${target}`, flags: MessageFlags.Ephemeral });
  },
};

module.exports = { commands: [selfroles, award], components: { sr: onSelect }, planSelect };
