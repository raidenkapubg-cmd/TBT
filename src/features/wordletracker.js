// Tracks results from Discord's OFFICIAL Wordle (members play it with Wordle's own /wordle or the 🚀 button).
// Two sources:
//  1. A member pastes their share text: "Wordle 1,234 3/6 ⬛🟨🟩…"
//  2. The Wordle app's daily recap message: "Here are yesterday's results: 👑 3/6: @a @b  4/6: @c  X/6: @d"
const { Events } = require('discord.js');
const config = require('../config');
const store = require('../store');
const { embed, todayKey } = require('../util/helpers');

const SHARE_RE = /Wordle\s+#?([\d.,\s]{1,7}?)\s+([1-6X])\/6\*?/i;
const RECAP_LINE_RE = /([1-6X])\/6:?\s*((?:<@!?\d+>\s*)+)/gi;

function profile(guildId, userId) {
  const u = store.user(guildId, userId);
  if (!u.wordleStats) u.wordleStats = { results: {}, played: 0, wins: 0, totalGuesses: 0, dist: [0, 0, 0, 0, 0, 0], fails: 0 };
  return u;
}

/** Record one result. Returns false if it was already recorded for that day. */
function record(guildId, userId, { score, day, puzzle }) {
  const u = profile(guildId, userId);
  const s = u.wordleStats;
  if (Object.values(s.results).some((r) => r.day === day)) return false;
  s.results[puzzle ? `p${puzzle}` : `d${day}`] = { score, day };
  // keep the last 400 results
  const keys = Object.keys(s.results);
  if (keys.length > 400) delete s.results[keys[0]];
  s.played++;
  if (score === 'X') s.fails++;
  else {
    s.wins++;
    s.totalGuesses += Number(score);
    s.dist[Number(score) - 1]++;
  }
  store.markDirty();
  return true;
}

function streak(stats) {
  const days = [...new Set(Object.values(stats.results).filter((r) => r.score !== 'X').map((r) => r.day))].sort().reverse();
  if (!days.length) return 0;
  const toDate = (d) => new Date(`${d}T12:00:00Z`).getTime();
  const today = todayKey();
  const yesterday = todayKey(new Date(Date.now() - 86400000));
  if (days[0] !== today && days[0] !== yesterday) return 0;
  let n = 1;
  for (let k = 1; k < days.length; k++) {
    if (Math.round((toDate(days[k - 1]) - toDate(days[k])) / 86400000) === 1) n++;
    else break;
  }
  return n;
}

function xpFor(score) {
  return score === 'X' ? 10 : 30 + (6 - Number(score)) * 10;
}

const REACT = { 1: '🤯', 2: '🔥', 3: '😎', 4: '👍', 5: '😅', 6: '😮‍💨', X: '💀' };

/** Parse a message; returns [{ userId, score, day, puzzle }]. Pure, for testing. */
function parse(msg) {
  const out = [];
  const day = todayKey(msg.createdAt || new Date());
  const text = msg.content || '';
  const isWordleApp = msg.author?.bot && /wordle/i.test(msg.author.username || '');

  if (isWordleApp) {
    const yesterday = todayKey(new Date((msg.createdTimestamp || Date.now()) - 86400000));
    const recapDay = /yesterday/i.test(text) ? yesterday : day;
    for (const m of text.matchAll(RECAP_LINE_RE)) {
      for (const id of m[2].matchAll(/<@!?(\d+)>/g)) out.push({ userId: id[1], score: m[1].toUpperCase(), day: recapDay, puzzle: null });
    }
    return out;
  }
  if (msg.author?.bot) return out;
  const m = text.match(SHARE_RE);
  if (m && /[🟩🟨⬛⬜]/u.test(text)) {
    out.push({ userId: msg.author.id, score: m[2].toUpperCase(), day, puzzle: m[1].replace(/[^\d]/g, '') || null });
  }
  return out;
}

function init(client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild) return;
    const results = parse(msg);
    if (!results.length) return;
    let any = false;
    for (const r of results) {
      if (!record(msg.guild.id, r.userId, r)) continue;
      any = true;
      const member = await msg.guild.members.fetch(r.userId).catch(() => null);
      if (member) await require('./levels').addXp(member, xpFor(r.score), null);
    }
    if (any && !msg.author.bot) await msg.react(REACT[results[0].score] || '🟩').catch(() => {});
    if (any && msg.author.bot) await msg.react('📊').catch(() => {});
  });
}

function statsEmbed(member) {
  const u = profile(member.guild.id, member.id);
  const s = u.wordleStats;
  const max = Math.max(1, ...s.dist);
  const bars = s.dist.map((n, k) => `${k + 1} ${'🟩'.repeat(Math.max(n ? 1 : 0, Math.round((n / max) * 10)))} ${n}`).join('\n');
  return embed(0x538d4e)
    .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
    .setTitle('🟩 Wordle stats')
    .setDescription(s.played ? bars : 'No results yet — play the official Wordle with `/wordle` and paste your result here!')
    .addFields(
      { name: 'Played', value: `${s.played}`, inline: true },
      { name: 'Win %', value: `${s.played ? Math.round((s.wins / s.played) * 100) : 0}%`, inline: true },
      { name: 'Avg guesses', value: s.wins ? (s.totalGuesses / s.wins).toFixed(2) : '—', inline: true },
      { name: 'Current streak', value: `🔥 ${streak(s)}`, inline: true },
    );
}

function leaderboardRows(guildId) {
  return Object.entries(store.guild(guildId).users)
    .filter(([, u]) => u.wordleStats?.played)
    .map(([id, u]) => {
      const s = u.wordleStats;
      return { id, played: s.played, wins: s.wins, avg: s.wins ? s.totalGuesses / s.wins : 9, streak: streak(s) };
    })
    .sort((a, b) => b.wins - a.wins || a.avg - b.avg)
    .slice(0, 10);
}

module.exports = { init, parse, record, streak, xpFor, statsEmbed, leaderboardRows };
