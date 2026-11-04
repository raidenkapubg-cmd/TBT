const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const config = require('../config');
const store = require('../store');
const wordle = require('../games/wordle');
const fish = require('../games/fish');
const { embed, todayKey, sleep, rand } = require('../util/helpers');

// ================================================================= WORDLE
const wordleGames = new Map(); // `${guildId}:${userId}` -> game

function wordleView(game, user, note = '') {
  const png = wordle.render(game);
  const file = new AttachmentBuilder(png, { name: 'wordle.png' });
  const title = game.daily ? `🟩 Daily Wordle · ${game.dateKey}` : '🟨 Practice Wordle';
  let desc = note;
  if (game.done) {
    desc = game.won
      ? `🎉 **Got it in ${game.guesses.length}/6!** The word was **${game.answer.toUpperCase()}**.`
      : `💀 Out of guesses! The word was **${game.answer.toUpperCase()}**.`;
  }
  const e = embed(game.done ? (game.won ? config.color.good : config.color.bad) : 0x538d4e)
    .setAuthor({ name: user.displayName || user.username, iconURL: user.displayAvatarURL() })
    .setTitle(title)
    .setDescription(desc || `Guess ${game.guesses.length + 1}/6 — hit **Guess** to type a word.`)
    .setImage('attachment://wordle.png');
  const components = game.done
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`wordle:share:${user.id}`).setLabel('Share result').setEmoji('📤').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`wordle:again:${user.id}`).setLabel('Practice round').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
        ),
      ]
    : [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`wordle:guess:${user.id}`).setLabel('Guess').setEmoji('⌨️').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`wordle:quit:${user.id}`).setLabel('Give up').setStyle(ButtonStyle.Secondary),
        ),
      ];
  return { embeds: [e], files: [file], components };
}

async function finishWordle(interaction, game) {
  const u = store.user(interaction.guild.id, interaction.user.id);
  u.wordle.played++;
  if (game.won) {
    u.wordle.won++;
    const xp = game.daily ? 60 + (6 - game.guesses.length) * 15 : 15 + (6 - game.guesses.length) * 5;
    const coins = game.daily ? 50 : 10;
    u.coins += coins;
    if (game.daily) {
      u.wordle.streak++;
      u.wordle.best = Math.max(u.wordle.best, u.wordle.streak);
    }
    await require('../features/levels').addXp(interaction.member, xp, interaction.channel);
  } else if (game.daily) {
    u.wordle.streak = 0;
  }
  store.markDirty();
}

async function startWordle(interaction, daily) {
  const key = `${interaction.guild.id}:${interaction.user.id}`;
  const dateKey = todayKey();
  const u = store.user(interaction.guild.id, interaction.user.id);
  if (daily && u.wordle.lastDaily === dateKey && !wordleGames.get(key)?.daily) {
    return interaction.reply({ content: '✅ You already played today\'s Wordle! Come back tomorrow, or try `/wordle practice`.', flags: MessageFlags.Ephemeral });
  }
  let game = wordleGames.get(key);
  if (!game || game.done || game.daily !== daily) {
    game = wordle.newGame({ daily, dateKey });
    wordleGames.set(key, game);
    if (daily) {
      u.wordle.lastDaily = dateKey;
      store.markDirty();
    }
  }
  // Daily games are private so nobody spoils the word; practice games are public for fun.
  return interaction.reply({ ...wordleView(game, interaction.member || interaction.user), flags: daily ? MessageFlags.Ephemeral : undefined });
}

async function onWordle(interaction) {
  const [, action, ownerId] = interaction.customId.split(':');
  const key = `${interaction.guild.id}:${interaction.user.id}`;
  const game = wordleGames.get(key);

  if (action === 'again') return startWordle(interaction, false);
  if (ownerId && ownerId !== interaction.user.id) {
    return interaction.reply({ content: 'This isn\'t your board! Start your own with `/wordle`.', flags: MessageFlags.Ephemeral });
  }

  if (action === 'share') {
    if (!game || !game.done) return interaction.reply({ content: 'No finished game to share.', flags: MessageFlags.Ephemeral });
    const u = store.user(interaction.guild.id, interaction.user.id);
    await interaction.channel.send({
      content: `${game.daily ? `🟩 **Daily Wordle ${game.dateKey}**` : '🟨 **Practice Wordle**'} — <@${interaction.user.id}> ${game.won ? `${game.guesses.length}/6` : 'X/6'}${game.daily ? ` · 🔥 streak ${u.wordle.streak}` : ''}\n${wordle.emojiGrid(game)}`,
      allowedMentions: { parse: [] },
    });
    return interaction.reply({ content: 'Shared! 📤', flags: MessageFlags.Ephemeral });
  }

  if (!game) return interaction.reply({ content: 'That game expired. Start a new one with `/wordle`.', flags: MessageFlags.Ephemeral });

  if (action === 'quit') {
    game.done = true;
    await finishWordle(interaction, game);
    return interaction.update(wordleView(game, interaction.member));
  }

  if (action === 'guess') {
    const modal = new ModalBuilder()
      .setCustomId(`wordle:submit:${interaction.user.id}`)
      .setTitle(`Guess ${game.guesses.length + 1}/6`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('word').setLabel('Your 5-letter word').setStyle(TextInputStyle.Short).setMinLength(5).setMaxLength(5).setRequired(true),
        ),
      );
    return interaction.showModal(modal);
  }

  if (action === 'submit') {
    const word = interaction.fields.getTextInputValue('word');
    const res = wordle.guess(game, word);
    if (res.error) {
      return interaction.update({ ...wordleView(game, interaction.member, `⚠️ ${res.error}`) });
    }
    if (game.done) await finishWordle(interaction, game);
    return interaction.update(wordleView(game, interaction.member));
  }
}

// ================================================================= FISHING
const casting = new Map(); // userId -> { phase, biteAt, token, msgId }

function fishProfile(guildId, userId) {
  const u = store.user(guildId, userId);
  if (!u.fish) u.fish = { rod: 'twig', location: 'pond', bag: [], caught: 0, index: [] };
  if (!Array.isArray(u.fish.bag)) u.fish.bag = [];
  return u;
}

const rarityIcon = (k) => fish.RARITIES.find((r) => r.key === k)?.icon || '⚪';

async function cast(interaction) {
  const u = fishProfile(interaction.guild.id, interaction.user.id);
  if (casting.has(interaction.user.id)) return interaction.reply({ content: '🎣 You already have a line in the water!', flags: MessageFlags.Ephemeral });
  if (u.fish.bag.length >= 100) return interaction.reply({ content: '🎒 Your bag is full (100 fish)! `/fish sell` first.', flags: MessageFlags.Ephemeral });

  const rod = fish.rodByKey(u.fish.rod);
  const loc = fish.locByKey(u.fish.location);
  const token = `${Date.now()}`;
  const state = { phase: 'wait', biteAt: 0, token };
  casting.set(interaction.user.id, state);
  setTimeout(() => casting.get(interaction.user.id)?.token === token && casting.delete(interaction.user.id), 30000).unref();

  const reelRow = (enabled, label = 'Reel!') =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`fish:reel:${interaction.user.id}:${token}`).setLabel(label).setEmoji('🎣').setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

  const base = embed(0x1f8acb).setAuthor({ name: `${interaction.member.displayName} · ${rod.icon} ${rod.name}`, iconURL: interaction.user.displayAvatarURL() });
  await interaction.reply({
    embeds: [base.setTitle(`${loc.icon} ${loc.name}`).setDescription('You cast your line… 〰️〰️〰️🎣\n*Wait for the bite. Don\'t reel early!*')],
    components: [reelRow(true, 'Reel')],
  });

  // 30% chance of a fake nibble first — reeling then scares the fish
  if (Math.random() < 0.3) {
    await sleep(rand(1500, 3500));
    if (casting.get(interaction.user.id)?.token !== token) return;
    await interaction.editReply({ embeds: [base.setDescription('〰️〰️ *…a nibble?* 〰️🎣\n*Steady…*')] }).catch(() => {});
  }
  await sleep(rand(2000, 6000));
  const s = casting.get(interaction.user.id);
  if (!s || s.token !== token) return;
  s.phase = 'bite';
  s.biteAt = Date.now();
  await interaction.editReply({ embeds: [base.setColor(0xf1c40f).setDescription('‼️ **BITE!** ‼️ 🐟💦\n**REEL NOW!**')], components: [reelRow(true, 'REEL!')] }).catch(() => {});

  await sleep(rod.window + 400);
  const s2 = casting.get(interaction.user.id);
  if (s2 && s2.token === token && s2.phase === 'bite') {
    casting.delete(interaction.user.id);
    await interaction.editReply({ embeds: [base.setColor(0x99aab5).setDescription('💨 Too slow! The fish got away.')], components: [] }).catch(() => {});
  }
}

async function onFish(interaction) {
  const [, action, userId, token] = interaction.customId.split(':');
  if (action !== 'reel') return;
  if (interaction.user.id !== userId) return interaction.reply({ content: 'Not your line! Cast your own with `/fish cast` 🎣', flags: MessageFlags.Ephemeral });
  const s = casting.get(userId);
  if (!s || s.token !== token) return interaction.reply({ content: 'This cast is over.', flags: MessageFlags.Ephemeral });
  casting.delete(userId);

  const u = fishProfile(interaction.guild.id, userId);
  const rod = fish.rodByKey(u.fish.rod);
  const e = embed(0x1f8acb).setAuthor({ name: `${interaction.member.displayName} · ${rod.icon} ${rod.name}`, iconURL: interaction.user.displayAvatarURL() });

  if (s.phase !== 'bite') {
    return interaction.update({ embeds: [e.setColor(0x99aab5).setDescription('😬 You reeled too early and scared the fish away!')], components: [] });
  }
  const reaction = Date.now() - s.biteAt;
  if (reaction > rod.window) {
    return interaction.update({ embeds: [e.setColor(0x99aab5).setDescription(`💨 ${reaction}ms — too slow! The fish got away.`)], components: [] });
  }
  const perfect = reaction < rod.window * 0.35;
  const c = fish.catchFish({ rodKey: u.fish.rod, locKey: u.fish.location, perfect });
  u.fish.bag.push({ id: c.id, n: c.name, e: c.emoji, r: c.rarity, kg: c.kg, v: c.value, m: c.mutation });
  u.fish.caught++;
  const isNew = !u.fish.index.includes(c.id);
  if (isNew) u.fish.index.push(c.id);
  store.markDirty();

  const rarity = fish.RARITIES.find((r) => r.key === c.rarity);
  const color = { common: 0x99aab5, uncommon: 0x2ecc71, rare: 0x3498db, epic: 0x9b59b6, legendary: 0xe67e22, mythic: 0xe74c3c }[c.rarity];
  const xp = { common: 5, uncommon: 10, rare: 20, epic: 40, legendary: 80, mythic: 200 }[c.rarity];
  await interaction.update({
    embeds: [
      e.setColor(color)
        .setTitle(`${c.mutation ? `${fish.MUTATIONS.find((m) => m.name === c.mutation).icon} ${c.mutation} ` : ''}${c.emoji} ${c.name}`)
        .setDescription(
          [
            `${rarity.icon} **${rarity.name}** · ⚖️ ${c.kg} kg · 🪙 ${c.value}`,
            `${perfect ? '🎯 **PERFECT REEL!**' : '✅ Nice reel!'} (${reaction}ms)`,
            isNew ? '📖 **New species discovered!**' : '',
          ].filter(Boolean).join('\n'),
        )
        .setFooter({ text: `Bag: ${u.fish.bag.length}/100 · /fish sell to cash out` }),
    ],
    components: [
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('fishcast').setLabel('Cast again').setEmoji('🎣').setStyle(ButtonStyle.Primary)),
    ],
  });
  if (['legendary', 'mythic'].includes(c.rarity) || c.mutation === 'Golden') {
    await interaction.channel.send(`📢 **<@${userId}> just caught a ${rarity.icon} ${rarity.name} ${c.mutation ? `${c.mutation} ` : ''}${c.name}!** 🎉`).catch(() => {});
  }
  await require('../features/levels').addXp(interaction.member, xp, null);
}

function fishBag(i) {
  const u = fishProfile(i.guild.id, i.user.id);
  const bag = u.fish.bag;
  const total = bag.reduce((a, f) => a + f.v, 0);
  const grouped = {};
  for (const f of bag) {
    const k = `${f.m ? `${f.m} ` : ''}${f.n}`;
    grouped[k] = grouped[k] || { e: f.e, r: f.r, n: 0, v: 0 };
    grouped[k].n++;
    grouped[k].v += f.v;
  }
  const order = fish.RARITIES.map((r) => r.key);
  const linesOut = Object.entries(grouped)
    .sort((a, b) => order.indexOf(b[1].r) - order.indexOf(a[1].r))
    .slice(0, 25)
    .map(([name, g]) => `${rarityIcon(g.r)} ${g.e} **${name}** ×${g.n} — 🪙 ${g.v}`);
  return i.reply({
    embeds: [
      embed(0x1f8acb)
        .setTitle(`🎒 ${i.member.displayName}'s bag`)
        .setDescription(linesOut.join('\n') || '*Empty. Go catch something!*')
        .addFields(
          { name: 'Bag value', value: `🪙 ${total}`, inline: true },
          { name: 'Wallet', value: `🪙 ${u.coins}`, inline: true },
          { name: 'Rod', value: `${fish.rodByKey(u.fish.rod).icon} ${fish.rodByKey(u.fish.rod).name}`, inline: true },
        ),
    ],
  });
}

const fishCommand = {
  data: new SlashCommandBuilder()
    .setName('fish')
    .setDescription('Go fishing 🎣')
    .addSubcommand((s) => s.setName('cast').setDescription('Cast your line'))
    .addSubcommand((s) => s.setName('bag').setDescription('See what you\'ve caught'))
    .addSubcommand((s) => s.setName('sell').setDescription('Sell every fish in your bag'))
    .addSubcommand((s) => s.setName('shop').setDescription('Rods for sale'))
    .addSubcommand((s) =>
      s.setName('buy').setDescription('Buy a rod').addStringOption((o) =>
        o.setName('rod').setDescription('Which rod').setRequired(true).addChoices(...fish.RODS.filter((r) => r.price > 0).map((r) => ({ name: `${r.name} (🪙 ${r.price})`, value: r.key }))),
      ),
    )
    .addSubcommand((s) =>
      s.setName('travel').setDescription('Fish somewhere new').addStringOption((o) =>
        o.setName('spot').setDescription('Where to').setRequired(true).addChoices(...fish.LOCATIONS.map((l) => ({ name: `${l.name} (needs ${fish.rodByKey(l.needs).name})`, value: l.key }))),
      ),
    )
    .addSubcommand((s) => s.setName('index').setDescription('Your species collection')),
  async execute(i) {
    const sub = i.options.getSubcommand();
    const u = fishProfile(i.guild.id, i.user.id);
    if (sub === 'cast') return cast(i);
    if (sub === 'bag') return fishBag(i);
    if (sub === 'sell') {
      const total = u.fish.bag.reduce((a, f) => a + f.v, 0);
      const n = u.fish.bag.length;
      if (!n) return i.reply({ content: '🎒 Nothing to sell.', flags: MessageFlags.Ephemeral });
      u.coins += total;
      u.fish.bag = [];
      store.markDirty();
      return i.reply(`💰 Sold **${n}** fish for **🪙 ${total}**. Wallet: 🪙 ${u.coins}`);
    }
    if (sub === 'shop') {
      const cur = fish.rodRank(u.fish.rod);
      return i.reply({
        embeds: [
          embed(0x1f8acb)
            .setTitle('🏪 Tackle Shop')
            .setDescription(
              fish.RODS.map((r, idx) => `${r.icon} **${r.name}** — ${r.price ? `🪙 ${r.price}` : 'free'}\n└ luck +${r.luck} · reel window ${(r.window / 1000).toFixed(1)}s ${idx === cur ? '**(equipped)**' : idx < cur ? '✅' : ''}`).join('\n'),
            )
            .setFooter({ text: `Wallet: 🪙 ${u.coins} · /fish buy` }),
        ],
      });
    }
    if (sub === 'buy') {
      const rod = fish.rodByKey(i.options.getString('rod'));
      if (fish.rodRank(rod.key) <= fish.rodRank(u.fish.rod)) return i.reply({ content: 'You already have that rod or a better one.', flags: MessageFlags.Ephemeral });
      if (u.coins < rod.price) return i.reply({ content: `💸 You need 🪙 ${rod.price - u.coins} more.`, flags: MessageFlags.Ephemeral });
      u.coins -= rod.price;
      u.fish.rod = rod.key;
      store.markDirty();
      return i.reply(`🛒 <@${i.user.id}> bought the **${rod.icon} ${rod.name}**! Luck +${rod.luck}.`);
    }
    if (sub === 'travel') {
      const loc = fish.locByKey(i.options.getString('spot'));
      if (!fish.canFishAt(u.fish.rod, loc.key)) return i.reply({ content: `🚫 ${loc.name} needs at least a **${fish.rodByKey(loc.needs).name}**.`, flags: MessageFlags.Ephemeral });
      u.fish.location = loc.key;
      store.markDirty();
      return i.reply(`🧭 You travel to **${loc.icon} ${loc.name}**. New waters, new fish!`);
    }
    if (sub === 'index') {
      const found = new Set(u.fish.index);
      const desc = fish.LOCATIONS.map((l) => {
        const all = Object.entries(l.fish).flatMap(([r, pool]) => pool.map((f) => ({ r, n: f[0], e: f[1] })));
        const have = all.filter((f) => found.has(`${l.key}:${f.n}`));
        return `**${l.icon} ${l.name}** — ${have.length}/${all.length}\n${all.map((f) => (found.has(`${l.key}:${f.n}`) ? f.e : '❔')).join(' ')}`;
      }).join('\n\n');
      return i.reply({ embeds: [embed(0x1f8acb).setTitle(`📖 Fish Index — ${found.size}/${fish.totalSpecies()}`).setDescription(desc)] });
    }
  },
};

const wordleCommand = {
  data: new SlashCommandBuilder()
    .setName('wordle')
    .setDescription('Play Wordle')
    .addSubcommand((s) => s.setName('daily').setDescription('Today\'s word — same for everyone, once a day'))
    .addSubcommand((s) => s.setName('practice').setDescription('Unlimited practice games'))
    .addSubcommand((s) => s.setName('stats').setDescription('Your Wordle stats').addUserOption((o) => o.setName('user').setDescription('Someone else'))),
  async execute(i) {
    const sub = i.options.getSubcommand();
    if (sub === 'daily') return startWordle(i, true);
    if (sub === 'practice') return startWordle(i, false);
    const user = i.options.getUser('user') || i.user;
    const w = store.user(i.guild.id, user.id).wordle;
    return i.reply({
      embeds: [
        embed(0x538d4e)
          .setTitle(`🟩 Wordle stats — ${user.username}`)
          .addFields(
            { name: 'Played', value: `${w.played}`, inline: true },
            { name: 'Win %', value: `${w.played ? Math.round((w.won / w.played) * 100) : 0}%`, inline: true },
            { name: 'Daily streak', value: `🔥 ${w.streak} (best ${w.best})`, inline: true },
          ),
      ],
    });
  },
};

module.exports = {
  commands: [wordleCommand, fishCommand],
  components: {
    wordle: onWordle,
    fish: onFish,
    fishcast: (i) => cast(i),
  },
};
