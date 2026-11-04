const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config');
const store = require('../store');
const groq = require('../util/groq');
const { isSafe, clean } = require('../util/safety');
const { embed, pick, hasRoleKey, progressBar } = require('../util/helpers');
const lines = require('../features/lines');
const banter = require('../features/banter');
const chatgames = require('../features/chatgames');

// ---------------------------------------------------------------- would you rather
const wyrVotes = new Map(); // messageId -> Map(userId -> 0|1)

function wyrPayload(pair, votes = new Map()) {
  const a = [...votes.values()].filter((v) => v === 0).length;
  const b = votes.size - a;
  const total = Math.max(1, votes.size);
  return {
    embeds: [
      embed(config.color.purple)
        .setTitle('🤔 Would you rather…')
        .setDescription(
          `🅰️ **${pair[0]}**\n${progressBar(a, total, 14)} ${Math.round((a / total) * 100)}% (${a})\n\n🅱️ **${pair[1]}**\n${progressBar(b, total, 14)} ${Math.round((b / total) * 100)}% (${b})`,
        )
        .setFooter({ text: `${votes.size} vote${votes.size === 1 ? '' : 's'} · tap to vote, tap again to switch` }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('wyr:0').setLabel('Option A').setEmoji('🅰️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('wyr:1').setLabel('Option B').setEmoji('🅱️').setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

async function newWyr() {
  if (groq.enabled() && Math.random() < 0.5) {
    const res = await groq.chatJson([
      { role: 'system', content: 'You write fun "would you rather" questions for a gaming & PC/mobile gear Discord. Clean, teen-friendly, no real-life sensitive topics.' },
      { role: 'user', content: 'Give one new would-you-rather. JSON: {"a":"option A","b":"option B"} each under 80 characters.' },
    ], { temperature: 1 });
    if (res?.a && res?.b && isSafe(res.a) && isSafe(res.b)) return [clean(res.a), clean(res.b)];
  }
  return pick(lines.WYR);
}

async function onWyr(interaction) {
  const choice = Number(interaction.customId.split(':')[1]);
  const votes = wyrVotes.get(interaction.message.id) || new Map();
  votes.set(interaction.user.id, choice);
  wyrVotes.set(interaction.message.id, votes);
  if (wyrVotes.size > 200) wyrVotes.delete(wyrVotes.keys().next().value);
  const desc = interaction.message.embeds[0]?.description || '';
  const pair = [desc.match(/🅰️ \*\*(.+?)\*\*/)?.[1] || 'A', desc.match(/🅱️ \*\*(.+?)\*\*/)?.[1] || 'B'];
  await interaction.update(wyrPayload(pair, votes));
}

// ---------------------------------------------------------------- trivia
const triviaGames = new Map(); // messageId -> { correct, answered: Set, winner }

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function newTrivia() {
  let q = null;
  if (groq.enabled() && Math.random() < 0.5) {
    const res = await groq.chatJson([
      { role: 'system', content: 'You write accurate multiple-choice trivia about gaming, esports and PC/gaming gear (mice, keyboards, monitors, headsets). Only use facts you are certain about.' },
      { role: 'user', content: 'One question. JSON: {"q":"question","correct":"right answer","wrong":["w1","w2","w3"]}. Answers under 60 characters.' },
    ], { temperature: 0.9 });
    if (res?.q && res?.correct && Array.isArray(res.wrong) && res.wrong.length >= 3 && isSafe(res.q)) {
      q = { q: res.q, options: [res.correct, ...res.wrong.slice(0, 3)] };
    }
  }
  if (!q) q = pick(lines.TRIVIA);
  const correct = q.options[0];
  const options = shuffle(q.options);
  return { q: q.q, options, correctIndex: options.indexOf(correct) };
}

function triviaPayload(t) {
  const letters = ['🇦', '🇧', '🇨', '🇩'];
  return {
    embeds: [
      embed(config.color.info)
        .setTitle('🧠 Trivia time!')
        .setDescription(`**${t.q}**\n\n${t.options.map((o, i) => `${letters[i]} ${o}`).join('\n')}`)
        .setFooter({ text: 'First correct answer wins 40 XP + 🪙 25. One guess each. 30 seconds!' }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        t.options.map((o, i) => new ButtonBuilder().setCustomId(`trivia:${i}`).setEmoji(letters[i]).setStyle(ButtonStyle.Secondary)),
      ),
    ],
  };
}

async function sendTrivia(channel) {
  const t = await newTrivia();
  const msg = await channel.send(triviaPayload(t));
  triviaGames.set(msg.id, { correct: t.correctIndex, answered: new Set(), winner: null, t });
  setTimeout(async () => {
    const g = triviaGames.get(msg.id);
    triviaGames.delete(msg.id);
    if (!g) return;
    const answer = t.options[t.correctIndex];
    await msg
      .edit({ components: [], embeds: [embed(g.winner ? config.color.good : 0x99aab5).setTitle('🧠 Trivia').setDescription(`**${t.q}**\n\n✅ ${answer}\n\n${g.winner ? `🏆 <@${g.winner}> got it first!` : '😶 Nobody got it.'}`)] })
      .catch(() => {});
  }, 30000);
  return msg;
}

async function onTrivia(interaction) {
  const g = triviaGames.get(interaction.message.id);
  if (!g) return interaction.reply({ content: 'This trivia is over!', flags: MessageFlags.Ephemeral });
  if (g.answered.has(interaction.user.id)) return interaction.reply({ content: 'One guess only! 😤', flags: MessageFlags.Ephemeral });
  g.answered.add(interaction.user.id);
  const pickIdx = Number(interaction.customId.split(':')[1]);
  if (pickIdx !== g.correct) return interaction.reply({ content: '❌ Nope!', flags: MessageFlags.Ephemeral });
  if (g.winner) return interaction.reply({ content: '✅ Correct — but someone was faster!', flags: MessageFlags.Ephemeral });
  g.winner = interaction.user.id;
  store.user(interaction.guild.id, interaction.user.id).coins += 25;
  store.markDirty();
  await require('../features/levels').addXp(interaction.member, 40, interaction.channel);
  return interaction.reply({ content: `🏆 <@${interaction.user.id}> got it first! **+40 XP, 🪙 25**` });
}

// ---------------------------------------------------------------- rock paper scissors
const RPS = { rock: '🪨', paper: '📄', scissors: '✂️' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const rpsDuels = new Map(); // id -> { a, b, picks: {} }

function rpsRow(id) {
  return new ActionRowBuilder().addComponents(
    Object.entries(RPS).map(([k, e]) => new ButtonBuilder().setCustomId(`rps:${id}:${k}`).setEmoji(e).setStyle(ButtonStyle.Secondary)),
  );
}

async function onRps(interaction) {
  const [, id, choice] = interaction.customId.split(':');
  const duel = rpsDuels.get(id);
  if (!duel) return interaction.reply({ content: 'This game is over.', flags: MessageFlags.Ephemeral });

  if (duel.vsBot) {
    if (interaction.user.id !== duel.a) return interaction.reply({ content: 'Start your own with /rps 😏', flags: MessageFlags.Ephemeral });
    rpsDuels.delete(id);
    const bot = pick(Object.keys(RPS));
    const res = choice === bot ? 'draw' : BEATS[choice] === bot ? 'win' : 'lose';
    const quip = { win: pick(['…I let you win. Obviously.', 'GG. Don\'t get used to it.']), lose: pick(['Too predictable. 🤖', 'Skill issue, respectfully.']), draw: pick(['Great minds. Or bots.', 'Run it back?']) }[res];
    if (res === 'win') {
      store.user(interaction.guild.id, interaction.user.id).coins += 10;
      store.markDirty();
    }
    return interaction.update({ content: `${RPS[choice]} vs ${RPS[bot]} — **${res === 'win' ? 'You win! 🪙 +10' : res === 'lose' ? 'King A wins!' : 'Draw!'}** ${quip}`, components: [] });
  }

  if (![duel.a, duel.b].includes(interaction.user.id)) return interaction.reply({ content: 'Not your duel!', flags: MessageFlags.Ephemeral });
  if (duel.picks[interaction.user.id]) return interaction.reply({ content: 'You already picked!', flags: MessageFlags.Ephemeral });
  duel.picks[interaction.user.id] = choice;
  if (!duel.picks[duel.a] || !duel.picks[duel.b]) {
    return interaction.reply({ content: `You picked ${RPS[choice]}. Waiting for your opponent…`, flags: MessageFlags.Ephemeral });
  }
  rpsDuels.delete(id);
  const pa = duel.picks[duel.a];
  const pb = duel.picks[duel.b];
  const winner = pa === pb ? null : BEATS[pa] === pb ? duel.a : duel.b;
  return interaction.update({
    content: `<@${duel.a}> ${RPS[pa]} vs ${RPS[pb]} <@${duel.b}> — ${winner ? `🏆 <@${winner}> wins!` : '🤝 Draw!'}`,
    components: [],
  });
}

// ---------------------------------------------------------------- hot take
async function hotTake(guild) {
  const text = await banter.generate(guild, 'Post one spicy-but-safe hot take about gaming, setups, gear or PC vs mobile that people will want to argue with. End with a short challenge like "fight me".', 'none');
  if (text && text !== 'SKIP') return text;
  return pick(lines.HOT_TAKES);
}

// ---------------------------------------------------------------- commands
const commands = [
  {
    data: new SlashCommandBuilder().setName('wyr').setDescription('Would you rather… (everyone votes)'),
    async execute(i) {
      await i.deferReply();
      await i.editReply(wyrPayload(await newWyr()));
    },
  },
  {
    data: new SlashCommandBuilder().setName('trivia').setDescription('Gaming & gear trivia — first right answer wins'),
    async execute(i) {
      await i.reply({ content: '🧠 Incoming…', flags: MessageFlags.Ephemeral });
      await sendTrivia(i.channel);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('rps')
      .setDescription('Rock paper scissors')
      .addUserOption((o) => o.setName('opponent').setDescription('Challenge someone (leave empty to play King A)')),
    async execute(i) {
      const opp = i.options.getUser('opponent');
      const id = `${i.id}`;
      if (!opp || opp.id === i.client.user.id) {
        rpsDuels.set(id, { a: i.user.id, vsBot: true, picks: {} });
        return i.reply({ content: '✊ Rock, paper, scissors… pick!', components: [rpsRow(id)] });
      }
      if (opp.bot || opp.id === i.user.id) return i.reply({ content: 'Pick a real opponent 😅', flags: MessageFlags.Ephemeral });
      rpsDuels.set(id, { a: i.user.id, b: opp.id, picks: {} });
      setTimeout(() => rpsDuels.delete(id), 120000).unref();
      return i.reply({ content: `⚔️ <@${i.user.id}> challenges <@${opp.id}> to rock paper scissors! Both pick below.`, components: [rpsRow(id)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('roastme').setDescription('Ask King A to roast you (needs the Roast Me role)'),
    async execute(i) {
      if (!hasRoleKey(i.member, 'roast_me')) {
        return i.reply({ content: '🔥 You need the **Roast Me** role first — grab it in self-roles (Vibe Check). Consent is important, even for roasts.', flags: MessageFlags.Ephemeral });
      }
      if (!banter.isRoastable(i.member)) {
        return i.reply({ content: '🍼 You\'re too new to be roasted. Come back after your first week here.', flags: MessageFlags.Ephemeral });
      }
      await i.deferReply();
      const roast = await banter.roastMember(i.member, i.channel);
      await i.editReply({ content: `🔥 <@${i.user.id}> ${roast}`, allowedMentions: { users: [] } });
    },
  },
  {
    data: new SlashCommandBuilder().setName('hottake').setDescription('King A drops a spicy hot take'),
    async execute(i) {
      await i.deferReply();
      await i.editReply(`🌶️ **Hot take:** ${await hotTake(i.guild)}`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('8ball')
      .setDescription('Ask the magic 8-ball')
      .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),
    async execute(i) {
      const answers = ['It is certain.', 'Without a doubt.', 'Ask your teammates.', 'Skill issue says no.', 'Signs point to yes.', 'Reply hazy, check your ping.', 'Absolutely not.', 'Only if you stop peeking mid.', 'My sources say no.', 'Yes — but clip it.', 'Outlook not so good.', 'Ranked gods say yes.'];
      await i.reply(`🎱 **${i.options.getString('question').slice(0, 200)}**\n${pick(answers)}`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('wars').setDescription('PC vs Mobile vs Console — this month\'s standings'),
    async execute(i) {
      const { rows, month, lastMonth } = chatgames.warStandings(i.guild);
      const max = Math.max(1, ...rows.map((r) => r.pts));
      const e = embed(config.color.main)
        .setTitle(`⚔️ Team Wars — ${month}`)
        .setDescription(rows.map((r, idx) => `${['🥇', '🥈', '🥉'][idx]} **${r.name}** — ${r.pts} pts\n${progressBar(r.pts, max, 16)}`).join('\n\n'))
        .setFooter({ text: 'Pick a side in self-roles. Messages, game wins and events earn points.' });
      if (lastMonth?.points) {
        const best = Object.entries(lastMonth.points).sort((a, b) => b[1] - a[1])[0];
        if (best) e.addFields({ name: `Last month (${lastMonth.month})`, value: `${chatgames.TEAMS[best[0]]} won with ${best[1]} pts` });
      }
      await i.reply({ embeds: [e] });
    },
  },
];

module.exports = { commands, components: { wyr: onWyr, trivia: onTrivia, rps: onRps }, wyrPayload, newWyr, sendTrivia, hotTake };
