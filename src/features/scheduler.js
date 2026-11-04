// Daily rhythm: question of the day, hot takes, dead-chat reviver, weekly game-night poll, monthly war results.
const { Events } = require('discord.js');
const cron = require('node-cron');
const config = require('../config');
const store = require('../store');
const { channel, pick, embed, todayKey } = require('../util/helpers');
const lines = require('./lines');
const banter = require('./banter');

const lastRevive = new Map(); // guildId -> ts

function hourIST() {
  return Number(new Date().toLocaleString('en-US', { timeZone: config.timezone, hour: 'numeric', hour12: false }));
}

async function forEachGuild(client, fn) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await fn(guild, store.guild(guild.id));
    } catch (err) {
      console.error('[scheduler]', err.message);
    }
  }
}

async function qotd(client) {
  await forEachGuild(client, async (guild, g) => {
    const ch = channel(guild, 'qotd');
    if (!ch) return;
    const day = todayKey();
    if (g.lastQotd === day) return;
    g.lastQotd = day;
    store.markDirty();
    let q = null;
    if (Math.random() < 0.5) {
      const out = await banter.generate(guild, 'Write one fun "question of the day" for a gaming and gear community. Just the question, no preamble.', 'none');
      if (out && out !== 'SKIP') q = out;
    }
    q = q || pick(lines.QOTD);
    const msg = await ch.send({ embeds: [embed(config.color.info).setTitle('❓ Question of the Day').setDescription(`**${q}**`).setFooter({ text: 'Answer in the thread 👇' })] });
    await msg.startThread({ name: `QOTD ${day}`, autoArchiveDuration: 1440 }).catch(() => {});
  });
}

async function hotTakeDrop(client) {
  await forEachGuild(client, async (guild, g) => {
    if (g.banter.paused) return;
    const ch = channel(guild, 'general');
    if (!ch) return;
    const { hotTake } = require('../commands/fun');
    const text = await hotTake(guild);
    await ch.send({ content: `🌶️ **Hot take:** ${text}`, allowedMentions: { parse: [] } });
    await banter.botLog(guild, ch, text, 'Scheduled hot take');
  });
}

async function deadChatCheck(client) {
  const h = hourIST();
  if (h < 12 || h >= 24) return; // peak hours only
  await forEachGuild(client, async (guild, g) => {
    if (g.banter.paused) return;
    const ch = channel(guild, 'general');
    if (!ch) return;
    const last = Math.max(banter.lastActivity(ch.id), ch.lastMessage?.createdTimestamp || 0);
    const quietFor = Date.now() - (last || 0);
    if (!last || quietFor < config.banter.deadChatMinutes * 60000) return;
    if (Date.now() - (lastRevive.get(guild.id) || 0) < 2 * 3600 * 1000) return;
    lastRevive.set(guild.id, Date.now());

    const fun = require('../commands/fun');
    const roll = Math.random();
    if (roll < 0.35) {
      await ch.send({ content: '💤 Chat\'s been dead for a while. Settle this:', ...fun.wyrPayload(await fun.newWyr()) });
    } else if (roll < 0.65) {
      await ch.send('🧠 Dead chat? Pop quiz!');
      await fun.sendTrivia(ch);
    } else {
      const { startRace, pickRaceWord } = require('./chatgames');
      const word = pickRaceWord();
      await ch.send(`⚡ **FIRST TO TYPE** \`${word}\` WINS 30 XP + 🪙 20! Go go go!`);
      startRace(ch, word);
    }
    await banter.botLog(guild, ch, 'Dead-chat reviver fired', 'Reviver');
  });
}

async function gameNightPoll(client) {
  await forEachGuild(client, async (guild) => {
    const ch = channel(guild, 'event_news');
    if (!ch) return;
    await ch
      .send({
        poll: {
          question: { text: '🌙 Saturday Game Night — what are we playing?' },
          answers: [
            { text: 'Valorant customs', emoji: '🎯' },
            { text: 'BGMI', emoji: '🔫' },
            { text: 'Minecraft', emoji: '⛏️' },
            { text: 'Party games (Skribbl / Among Us)', emoji: '🎉' },
            { text: 'CS2', emoji: '💣' },
          ],
          duration: 72,
          allowMultiselect: false,
        },
      })
      .catch((e) => console.error('[poll]', e.message));
  });
}

async function warsMonthly(client) {
  await forEachGuild(client, async (guild) => {
    const ch = channel(guild, 'wars');
    if (!ch) return;
    const { warStandings, TEAMS } = require('./chatgames');
    const { lastMonth } = warStandings(guild); // also rolls the month over
    if (!lastMonth?.points) return;
    const sorted = Object.entries(lastMonth.points).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return;
    await ch.send({
      embeds: [
        embed(config.color.main)
          .setTitle(`⚔️ Team Wars ${lastMonth.month} — FINAL`)
          .setDescription(`${sorted.map(([k, p], n) => `${['🥇', '🥈', '🥉'][n] || '•'} ${TEAMS[k]} — ${p} pts`).join('\n')}\n\n**${TEAMS[sorted[0][0]]} takes the crown!** 👑 New month, scores reset. Fight!`),
      ],
    });
  });
}

function init(client) {
  client.once(Events.ClientReady, () => {
    const tz = { timezone: config.timezone };
    cron.schedule('0 18 * * *', () => qotd(client), tz); // 6 PM daily
    cron.schedule('30 13 * * *', () => hotTakeDrop(client), tz); // 1:30 PM
    cron.schedule('30 20 * * *', () => hotTakeDrop(client), tz); // 8:30 PM
    cron.schedule('*/5 * * * *', () => deadChatCheck(client), tz);
    cron.schedule('0 12 * * 1', () => gameNightPoll(client), tz); // Monday noon
    cron.schedule('5 0 1 * *', () => warsMonthly(client), tz); // 1st of month
    console.log(`⏰ Scheduler running (${config.timezone})`);
  });
}

module.exports = { init, qotd, hotTakeDrop, deadChatCheck };
