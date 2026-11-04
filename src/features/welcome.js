const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const config = require('../config');
const { channel, pick, embed, fill } = require('../util/helpers');

const LINES = [
  '{user} just spawned in. Zero kills, infinite potential.',
  'A wild {user} appeared! It\'s super effective.',
  '{user} has entered the lobby. Ping 12ms. Vibes: immaculate.',
  '{user} joined. Somebody check their sensitivity settings.',
  'Everyone act cool, {user} is here.',
  '{user} just plugged in. RGB levels rising.',
  'Welcome {user}! Your mousepad has been assigned. Probably.',
  '{user} dropped in hot. Loot\'s in #introductions.',
  '{user} joined the server. The server is now 0.03% cooler.',
  'Patch notes: added {user}. Buffed the vibes.',
  '{user} has arrived. Quick, hide the cable spaghetti.',
  'New challenger approaching: {user}!',
  '{user} clicked "join" faster than their ranked teammates rotate.',
  '{user} is here. Is it PC or mobile? The war needs to know.',
];

const ICEBREAKERS = [
  'What\'s the one piece of gear you\'d never swap out?',
  'Most embarrassing gaming moment — go.',
  'PC, mobile or console? Defend your answer.',
  'What\'s your current main and why?',
  'Wired or wireless — and why are you wrong?',
  'What did your first setup look like?',
  'Which game do you keep uninstalling and reinstalling?',
  'Hot take: what\'s the most overrated game right now?',
  'What\'s your dream setup if money didn\'t exist?',
  'Clutch or choke: describe your last 1v3.',
  'What\'s the weirdest thing on your desk right now?',
  'Light mode or dark mode? (There is a wrong answer.)',
];

const waves = new Map(); // messageId -> Set(userId)

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth, startSize, weight = 'bold') {
  let size = startSize;
  do {
    ctx.font = `${weight} ${size}px sans-serif`;
    size -= 2;
  } while (ctx.measureText(text).width > maxWidth && size > 14);
}

async function makeCard({ username, avatarUrl, memberNumber, tagline, guildName }) {
  const W = 1000;
  const H = 360;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#16161d');
  bg.addColorStop(1, '#24151a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // diagonal accent stripes
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#e2452d';
  for (let x = -H; x < W; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + 30, H);
    ctx.lineTo(x + 30 + H, 0);
    ctx.lineTo(x + H, 0);
    ctx.fill();
  }
  ctx.restore();

  // glowing blob behind avatar
  const glow = ctx.createRadialGradient(180, 180, 20, 180, 180, 200);
  glow.addColorStop(0, 'rgba(226,69,45,0.55)');
  glow.addColorStop(1, 'rgba(226,69,45,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 420, H);

  // card frame
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  roundRect(ctx, 14, 14, W - 28, H - 28, 26);
  ctx.stroke();

  // avatar
  try {
    const res = await fetch(avatarUrl);
    const img = await loadImage(Buffer.from(await res.arrayBuffer()));
    ctx.save();
    ctx.beginPath();
    ctx.arc(180, 180, 110, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 70, 70, 220, 220);
    ctx.restore();
  } catch {
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(180, 180, 110, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#e2452d';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(180, 180, 116, 0, Math.PI * 2);
  ctx.stroke();

  // level badge
  ctx.fillStyle = '#e2452d';
  roundRect(ctx, 120, 282, 120, 38, 19);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('LVL 0', 180, 308);

  // text
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e2452d';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('PLAYER JOINED', 340, 100);

  ctx.fillStyle = '#ffffff';
  fitText(ctx, username, 600, 64);
  ctx.fillText(username, 340, 170);

  ctx.fillStyle = '#b9bbbe';
  fitText(ctx, tagline, 610, 28, '500');
  ctx.fillText(tagline, 340, 220);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, 340, 250, 600, 56, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`#${memberNumber.toLocaleString('en-IN')}`, 360, 287);
  ctx.fillStyle = '#b9bbbe';
  ctx.font = '22px sans-serif';
  const label = `member of ${guildName}`;
  ctx.fillText(label.length > 40 ? label.slice(0, 39) + '…' : label, 360 + ctx.measureText(`#${memberNumber}`).width + 40, 287);

  return canvas.toBuffer('image/png');
}

const TAGLINES = [
  'Spawned with 0 kills and infinite potential',
  'RGB levels rising. Vibes: immaculate.',
  'New challenger approaching',
  'Loading personality... 100%',
  'Has entered the lobby',
  'Respawned in the right server',
];

async function onJoin(member) {
  if (member.user.bot) return;
  const ch = channel(member.guild, 'welcome');
  if (!ch) return;

  const roles = channel(member.guild, 'self_roles');
  const intro = channel(member.guild, 'introductions');
  const line = fill(pick(LINES), { user: `<@${member.id}>` });

  const files = [];
  try {
    const png = await makeCard({
      username: member.user.globalName || member.user.username,
      avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
      memberNumber: member.guild.memberCount,
      tagline: pick(TAGLINES),
      guildName: member.guild.name,
    });
    files.push(new AttachmentBuilder(png, { name: 'welcome.png' }));
  } catch (err) {
    console.error('[welcome] card failed:', err.message);
  }

  const e = embed(config.color.main)
    .setDescription(
      [
        line,
        '',
        `**Step 1:** pick your roles ${roles ? `in ${roles}` : ''}`,
        `**Step 2:** introduce yourself ${intro ? `in ${intro}` : ''}`,
        '**Step 3:** say hi in general and pick a side in the PC vs Mobile war ⚔️',
      ].join('\n'),
    )
    .setFooter({ text: `You're member #${member.guild.memberCount}` });
  if (files.length) e.setImage('attachment://welcome.png');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`welcome:wave:${member.id}`).setLabel('Wave').setEmoji('👋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('welcome:ice').setLabel('Icebreaker').setEmoji('🎲').setStyle(ButtonStyle.Secondary),
  );
  if (roles) {
    row.addComponents(
      new ButtonBuilder().setLabel('Get roles').setEmoji('🎭').setStyle(ButtonStyle.Link).setURL(roles.url),
    );
  }

  await ch.send({ content: `<@${member.id}>`, embeds: [e], files, components: [row] }).catch((err) =>
    console.error('[welcome] send failed:', err.message),
  );
}

async function onButton(interaction) {
  const [, action, targetId] = interaction.customId.split(':');
  if (action === 'ice') {
    return interaction.reply({
      content: `🎲 **Icebreaker:** ${pick(ICEBREAKERS)}\n*Answer it in introductions or general!*`,
      flags: MessageFlags.Ephemeral,
    });
  }
  if (action === 'wave') {
    if (interaction.user.id === targetId) {
      return interaction.reply({ content: 'Waving at yourself? Bold. 👋', flags: MessageFlags.Ephemeral });
    }
    const set = waves.get(interaction.message.id) || new Set();
    if (set.has(interaction.user.id)) {
      return interaction.reply({ content: 'You already waved! 👋', flags: MessageFlags.Ephemeral });
    }
    set.add(interaction.user.id);
    waves.set(interaction.message.id, set);
    if (waves.size > 500) waves.delete(waves.keys().next().value);

    const rows = interaction.message.components.map((r) => ActionRowBuilder.from(r));
    rows[0].components[0].setLabel(`Wave · ${set.size}`);
    const embeds = interaction.message.embeds.map((e) => EmbedBuilder.from(e));
    if (embeds[0]) {
      const ids = [...set].slice(-15).map((id) => `<@${id}>`).join(' ');
      const fields = (embeds[0].data.fields || []).filter((f) => !f.name.startsWith('👋'));
      embeds[0].setFields(...fields, { name: `👋 Welcomed by ${set.size}`, value: ids.slice(0, 1024) });
    }
    await interaction.update({ embeds, components: rows });
  }
}

function init(client) {
  client.on(Events.GuildMemberAdd, (m) => onJoin(m).catch((e) => console.error('[welcome]', e)));
}

module.exports = { init, components: { welcome: onButton }, makeCard, onJoin };
