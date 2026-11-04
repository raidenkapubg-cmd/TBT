// Giveaways that reward participation: entries scale with level, and new/alt accounts can't enter.
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, Events } = require('discord.js');
const config = require('../config');
const store = require('../store');
const { embed, role } = require('../util/helpers');

const timers = new Map();

function parseDuration(s) {
  const m = String(s).trim().match(/^(\d+)\s*(m|min|h|hr|d|day|w)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 'm').toLowerCase()[0];
  return n * { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[unit];
}

function entriesFor(member) {
  const u = store.user(member.guild.id, member.id);
  let n = 1;
  if (u.level >= 5) n += 1;
  if (u.level >= 10) n += 2;
  if (u.level >= 20) n += 2;
  return n;
}

function gwEmbed(gw, ended = false) {
  const people = Object.keys(gw.entrants).length;
  const tickets = Object.values(gw.entrants).reduce((a, b) => a + b, 0);
  return embed(ended ? 0x99aab5 : 0xe91e63)
    .setTitle(`🎁 ${gw.prize}`)
    .setDescription(
      [
        ended ? (gw.winners?.length ? `🏆 **Winner${gw.winners.length > 1 ? 's' : ''}:** ${gw.winners.map((id) => `<@${id}>`).join(', ')}` : '😶 No valid entries.') : `Ends <t:${Math.floor(gw.endsAt / 1000)}:R>`,
        `👥 ${people} entered · 🎟️ ${tickets} tickets · ${gw.winnerCount} winner${gw.winnerCount > 1 ? 's' : ''}`,
        '',
        '**How entries work**',
        '🎟️ 1 ticket for joining · +1 at level 5 · +2 more at level 10 · +2 more at level 20',
        gw.minLevel ? `🔒 Need level **${gw.minLevel}+**` : '',
        `🔒 Account must be ${gw.minAccountDays}+ days old`,
        gw.description ? `\n${gw.description}` : '',
      ].filter((x) => x !== '').join('\n'),
    )
    .setFooter({ text: `Hosted by ${gw.hostTag} · Winners must claim within 48h or it\'s re-drawn` });
}

function draw(gw, count) {
  const pool = [];
  for (const [id, n] of Object.entries(gw.entrants)) for (let k = 0; k < n; k++) pool.push(id);
  const winners = [];
  while (winners.length < count && pool.length) {
    const id = pool[Math.floor(Math.random() * pool.length)];
    winners.push(id);
    for (let k = pool.length - 1; k >= 0; k--) if (pool[k] === id) pool.splice(k, 1);
  }
  return winners;
}

async function end(client, guildId, id) {
  const g = store.guild(guildId);
  const gw = g.giveaways[id];
  if (!gw || gw.ended) return;
  gw.ended = true;
  gw.winners = draw(gw, gw.winnerCount);
  store.markDirty();
  const guild = client.guilds.cache.get(guildId);
  const ch = guild?.channels.cache.get(gw.channelId);
  if (!ch) return;
  const msg = await ch.messages.fetch(id).catch(() => null);
  if (msg) await msg.edit({ embeds: [gwEmbed(gw, true)], components: [] }).catch(() => {});
  await ch.send({
    content: gw.winners.length
      ? `🎉 Congrats ${gw.winners.map((w) => `<@${w}>`).join(', ')}! You won **${gw.prize}**! DM a staff member within 48 hours to claim.`
      : `😶 The **${gw.prize}** giveaway ended with no valid entries.`,
    reply: msg ? { messageReference: msg.id } : undefined,
  }).catch(() => {});
}

function schedule(client, guildId, id, endsAt) {
  clearTimeout(timers.get(id));
  const ms = Math.max(1000, endsAt - Date.now());
  // setTimeout max is ~24.8 days; re-check periodically for long giveaways
  timers.set(id, setTimeout(() => (Date.now() >= endsAt - 1000 ? end(client, guildId, id) : schedule(client, guildId, id, endsAt)), Math.min(ms, 2 ** 31 - 1)));
}

async function onEnter(interaction) {
  const id = interaction.customId.split(':')[1];
  const g = store.guild(interaction.guild.id);
  const gw = g.giveaways[id];
  if (!gw || gw.ended) return interaction.reply({ content: 'This giveaway has ended.', flags: MessageFlags.Ephemeral });
  const ageDays = (Date.now() - interaction.user.createdTimestamp) / 86400000;
  if (ageDays < gw.minAccountDays) return interaction.reply({ content: `🔒 Your account needs to be at least ${gw.minAccountDays} days old to enter.`, flags: MessageFlags.Ephemeral });
  const u = store.user(interaction.guild.id, interaction.user.id);
  if (gw.minLevel && u.level < gw.minLevel) return interaction.reply({ content: `🔒 You need level **${gw.minLevel}** (you're ${u.level}). Chat, play games and hang out to level up!`, flags: MessageFlags.Ephemeral });
  if (gw.entrants[interaction.user.id]) {
    delete gw.entrants[interaction.user.id];
    store.markDirty();
    await interaction.message.edit({ embeds: [gwEmbed(gw)] }).catch(() => {});
    return interaction.reply({ content: '🚪 You left the giveaway.', flags: MessageFlags.Ephemeral });
  }
  const n = entriesFor(interaction.member);
  gw.entrants[interaction.user.id] = n;
  store.markDirty();
  await interaction.message.edit({ embeds: [gwEmbed(gw)] }).catch(() => {});
  return interaction.reply({ content: `🎟️ You're in with **${n} ticket${n > 1 ? 's' : ''}**! Level up for more. (Click again to leave.)`, flags: MessageFlags.Ephemeral });
}

const giveaway = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Run giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('start').setDescription('Start a giveaway')
        .addStringOption((o) => o.setName('prize').setDescription('What are they winning').setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('e.g. 30m, 12h, 3d, 1w').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('How many winners').setMinValue(1).setMaxValue(20))
        .addIntegerOption((o) => o.setName('min_level').setDescription('Only members at this level or above').setMinValue(0))
        .addIntegerOption((o) => o.setName('min_account_days').setDescription('Minimum account age in days (default 30)').setMinValue(0))
        .addStringOption((o) => o.setName('description').setDescription('Extra info / rules'))
        .addChannelOption((o) => o.setName('channel').setDescription('Where (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption((o) => o.setName('ping').setDescription('Role to ping')),
    )
    .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now').addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)))
    .addSubcommand((s) => s.setName('reroll').setDescription('Pick new winner(s)').addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)).addIntegerOption((o) => o.setName('winners').setDescription('How many').setMinValue(1))),
  async execute(i) {
    const sub = i.options.getSubcommand();
    const g = store.guild(i.guild.id);
    if (sub === 'start') {
      const ms = parseDuration(i.options.getString('duration'));
      if (!ms || ms < 60000) return i.reply({ content: '❌ Duration must be at least 1 minute (e.g. 30m, 12h, 3d).', flags: MessageFlags.Ephemeral });
      const ch = i.options.getChannel('channel') || i.channel;
      const ping = i.options.getRole('ping') || role(i.guild, 'p_giveaways');
      const gw = {
        prize: i.options.getString('prize'),
        winnerCount: i.options.getInteger('winners') || 1,
        minLevel: i.options.getInteger('min_level') || 0,
        minAccountDays: i.options.getInteger('min_account_days') ?? 30,
        description: i.options.getString('description') || '',
        endsAt: Date.now() + ms,
        channelId: ch.id,
        hostTag: i.user.tag,
        entrants: {},
        ended: false,
      };
      const msg = await ch.send({
        content: ping ? `<@&${ping.id}>` : undefined,
        embeds: [gwEmbed(gw)],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gw:pending').setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Success))],
        allowedMentions: { roles: ping ? [ping.id] : [] },
      });
      await msg.edit({ components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gw:${msg.id}`).setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Success))] });
      g.giveaways[msg.id] = gw;
      store.markDirty();
      schedule(i.client, i.guild.id, msg.id, gw.endsAt);
      return i.reply({ content: `✅ Giveaway started in ${ch} (ID \`${msg.id}\`)`, flags: MessageFlags.Ephemeral });
    }
    const id = i.options.getString('message_id');
    const gw = g.giveaways[id];
    if (!gw) return i.reply({ content: '❌ No giveaway with that message ID.', flags: MessageFlags.Ephemeral });
    if (sub === 'end') {
      clearTimeout(timers.get(id));
      await end(i.client, i.guild.id, id);
      return i.reply({ content: '✅ Ended.', flags: MessageFlags.Ephemeral });
    }
    if (sub === 'reroll') {
      if (!gw.ended) return i.reply({ content: 'That giveaway hasn\'t ended yet.', flags: MessageFlags.Ephemeral });
      const pool = { ...gw, entrants: Object.fromEntries(Object.entries(gw.entrants).filter(([uid]) => !gw.winners.includes(uid))) };
      const winners = draw(pool, i.options.getInteger('winners') || 1);
      if (!winners.length) return i.reply({ content: 'No one left to pick.', flags: MessageFlags.Ephemeral });
      gw.winners.push(...winners);
      store.markDirty();
      return i.reply(`🔁 Re-roll for **${gw.prize}**: ${winners.map((w) => `<@${w}>`).join(', ')} — congrats! DM staff within 48h.`);
    }
  },
};

function init(client) {
  client.once(Events.ClientReady, () => {
    for (const [guildId, g] of Object.entries(store.raw.guilds)) {
      for (const [id, gw] of Object.entries(g.giveaways || {})) if (!gw.ended) schedule(client, guildId, id, gw.endsAt);
    }
  });
}

module.exports = { commands: [giveaway], components: { gw: onEnter }, init, parseDuration, draw, entriesFor };
