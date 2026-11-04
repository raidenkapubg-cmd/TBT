// Always-on channel games: counting, word chain, PC vs Mobile war points, first-to-type.
const { Events } = require('discord.js');
const store = require('../store');
const { channel, hasRoleKey, pick } = require('../util/helpers');
const { isEnglishWord } = require('../games/words');

const TEAMS = { team_pc: '🖥️ Team PC', team_mobile: '📱 Team Mobile', team_console: '🎮 Team Console' };

// ---- first-to-type (started by the dead-chat reviver or /firsttype)
const races = new Map(); // channelId -> { word, ends }

function startRace(ch, word) {
  races.set(ch.id, { word: word.toLowerCase(), ends: Date.now() + 60000 });
  setTimeout(() => {
    const r = races.get(ch.id);
    if (r && r.word === word.toLowerCase()) {
      races.delete(ch.id);
      ch.send(`⏰ Nobody typed **${word}** in time. Y'all are AFK.`).catch(() => {});
    }
  }, 60000).unref();
}

function warsMonth(g) {
  const month = new Date().toISOString().slice(0, 7);
  if (g.wars.month !== month) {
    g.wars = { month, points: {}, lastMonth: g.wars.month ? { month: g.wars.month, points: g.wars.points } : g.wars.lastMonth };
    store.markDirty();
  }
  return g.wars;
}

async function handleCounting(msg, g) {
  const n = Number(msg.content.trim().split(/\s/)[0]);
  if (!Number.isInteger(n)) return; // chatter is ignored, not punished
  const c = g.counting;
  if (msg.author.id === c.lastUser) {
    await msg.react('❌').catch(() => {});
    await msg.reply(`🚫 No double turns! Back to **0**. Next number is **1**. (Best: ${c.best})`).catch(() => {});
    g.counting = { current: 0, lastUser: null, best: c.best };
  } else if (n === c.current + 1) {
    c.current = n;
    c.lastUser = msg.author.id;
    if (n > c.best) c.best = n;
    await msg.react(n % 100 === 0 ? '💯' : n === c.best && n > 10 ? '🏆' : '✅').catch(() => {});
  } else {
    await msg.react('💥').catch(() => {});
    await msg.reply(`💥 <@${msg.author.id}> ruined it at **${c.current}**! Next number is **1**. (Best: ${c.best})`).catch(() => {});
    g.counting = { current: 0, lastUser: null, best: c.best };
  }
  store.markDirty();
}

async function handleWordChain(msg, g) {
  const word = msg.content.trim().toLowerCase();
  if (!/^[a-z]{2,}$/.test(word)) return;
  const w = g.wordchain;
  const need = w.lastWord ? w.lastWord.slice(-1) : null;
  let problem = null;
  if (msg.author.id === w.lastUser) problem = 'wait for someone else to go';
  else if (need && word[0] !== need) problem = `it has to start with **${need}**`;
  else if (w.used.includes(word)) problem = 'that word was already used';
  else if (!isEnglishWord(word)) problem = 'that\'s not in my dictionary';
  if (problem) {
    await msg.react('❌').catch(() => {});
    const r = await msg.reply(`❌ ${problem}.`).catch(() => null);
    if (r) setTimeout(() => r.delete().catch(() => {}), 6000).unref();
    return;
  }
  w.lastWord = word;
  w.lastUser = msg.author.id;
  w.used.push(word);
  if (w.used.length > 500) w.used.shift();
  store.markDirty();
  await msg.react(word.length >= 10 ? '🤯' : '✅').catch(() => {});
}

function init(client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot || !msg.member) return;
    const g = store.guild(msg.guild.id);

    if (msg.channel.id === g.channels.counting) return handleCounting(msg, g);
    if (msg.channel.id === g.channels.word_chain) return handleWordChain(msg, g);

    // First-to-type race
    const race = races.get(msg.channel.id);
    if (race && msg.content.trim().toLowerCase() === race.word) {
      races.delete(msg.channel.id);
      await msg.react('⚡').catch(() => {});
      await msg.reply(`⚡ **${msg.member.displayName}** typed it first! +30 XP & 🪙 20`).catch(() => {});
      store.user(msg.guild.id, msg.author.id).coins += 20;
      require('./levels').addXp(msg.member, 30, msg.channel).catch(() => {});
    }

    // PC vs Mobile wars: 1 point per message (max 1 per 30s per member)
    for (const key of Object.keys(TEAMS)) {
      if (hasRoleKey(msg.member, key)) {
        const wars = warsMonth(g);
        const u = store.user(msg.guild.id, msg.author.id);
        if (Date.now() - (u.lastWarPoint || 0) > 30000) {
          u.lastWarPoint = Date.now();
          wars.points[key] = (wars.points[key] || 0) + 1;
          store.markDirty();
        }
        break;
      }
    }
  });
}

function warStandings(guild) {
  const g = store.guild(guild.id);
  const wars = warsMonth(g);
  const rows = Object.entries(TEAMS)
    .map(([k, name]) => ({ name, pts: wars.points[k] || 0 }))
    .sort((a, b) => b.pts - a.pts);
  return { rows, month: wars.month, lastMonth: wars.lastMonth };
}

function addWarPoints(guild, teamKey, pts) {
  const g = store.guild(guild.id);
  const wars = warsMonth(g);
  wars.points[teamKey] = (wars.points[teamKey] || 0) + pts;
  store.markDirty();
}

module.exports = { init, startRace, warStandings, addWarPoints, TEAMS, races, pickRaceWord: () => pick(require('./lines').FIRST_TO_TYPE) };
