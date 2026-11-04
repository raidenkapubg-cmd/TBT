// XP & levels. Real chatting earns XP; spam earns nothing.
// Members keep only their highest level role (ladder in template.levelRoles, editable from the console).
const { Events } = require('discord.js');
const config = require('../config');
const store = require('../store');
const tpl = require('../setup/template');
const { rand, channel, role, pick } = require('../util/helpers');

const xpForLevel = (lvl) => 5 * lvl * lvl + 50 * lvl + 100; // XP needed to go from lvl -> lvl+1

function levelFromXp(totalXp) {
  let lvl = 0;
  let xp = totalXp;
  while (xp >= xpForLevel(lvl)) {
    xp -= xpForLevel(lvl);
    lvl++;
  }
  return { level: lvl, into: xp, needed: xpForLevel(lvl) };
}

function totalXpForLevel(level) {
  let t = 0;
  for (let l = 0; l < level; l++) t += xpForLevel(l);
  return t;
}

/** The level ladder for a guild: [{ level, roleId }] sorted ascending. */
function ladder(guild) {
  const g = store.guild(guild.id);
  const list = g.levelRoles || tpl.levelRoles.map((r) => ({ level: r.level, roleId: g.roles[r.key] })).filter((r) => r.roleId);
  return list.filter((r) => guild.roles.cache.has(r.roleId)).sort((a, b) => a.level - b.level);
}

const NO_XP_KEYS = ['counting', 'word_chain', 'console', 'mod_chat', 'bot_commands'];

// ---------------------------------------------------------------- spam-proof XP
const recentByUser = new Map(); // userId -> [{ ts, content }]

/** Returns a reason string if this message shouldn't earn XP, else null. */
function xpBlockReason(userId, u, content, now = Date.now()) {
  const text = String(content || '').trim();
  const hist = recentByUser.get(userId) || [];
  const recent = hist.filter((h) => now - h.ts < 10000);

  if ((u.xpMutedUntil || 0) > now) return 'muted';
  if (recent.length >= 5) {
    u.xpMutedUntil = now + 5 * 60000; // flooding: no XP for 5 minutes
    return 'flood';
  }
  if (now - (u.lastXp || 0) < config.levels.cooldownMs) return 'cooldown';
  const letters = text.replace(/<a?:\w+:\d+>|<@[!&]?\d+>|https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  if (letters.length < 4) return 'too short';
  if (/^(.)\1+$/i.test(letters) || new Set(letters.toLowerCase()).size <= 2) return 'repeated characters';
  const norm = text.toLowerCase().replace(/\s+/g, ' ');
  if (hist.some((h) => h.norm === norm && now - h.ts < 10 * 60000)) return 'duplicate';
  return null;
}

function remember(userId, content, now = Date.now()) {
  const hist = (recentByUser.get(userId) || []).filter((h) => now - h.ts < 10 * 60000);
  hist.push({ ts: now, norm: String(content || '').toLowerCase().trim().replace(/\s+/g, ' ') });
  while (hist.length > 15) hist.shift();
  recentByUser.set(userId, hist);
  if (recentByUser.size > 5000) recentByUser.delete(recentByUser.keys().next().value);
}

// Longer, real messages earn a little more.
function xpFor(content) {
  const words = String(content).trim().split(/\s+/).length;
  return rand(config.levels.xpMin, config.levels.xpMax) + Math.min(10, Math.floor(words / 4));
}

// ---------------------------------------------------------------- roles
const LEVEL_UP = [
  '{user} just hit **level {level}**! ⚡',
  'GG {user}, **level {level}** unlocked. 🎉',
  '{user} ranked up to **level {level}**. The grind is real. 💪',
  'Level **{level}** for {user}! Someone get this person a better mousepad. 🖱️',
  '{user} is now **level {level}**. Touch grass? Never heard of it. 🌱',
];

/** Gives the highest earned ladder role and removes lower ones. Returns names of newly given roles. */
async function syncLevelRoles(member, level) {
  const steps = ladder(member.guild);
  const earned = steps.filter((s) => level >= s.level);
  const top = earned[earned.length - 1];
  const given = [];
  for (const s of steps) {
    const has = member.roles.cache.has(s.roleId);
    if (top && s.roleId === top.roleId) {
      if (!has) {
        await member.roles.add(s.roleId).catch(() => {});
        given.push(member.guild.roles.cache.get(s.roleId)?.name);
      }
    } else if (has) {
      await member.roles.remove(s.roleId).catch(() => {});
    }
  }
  if (level >= config.levels.insiderLevel) {
    const r = role(member.guild, 'insider');
    if (r && !member.roles.cache.has(r.id)) {
      await member.roles.add(r).catch(() => {});
      given.push(r.name);
    }
  }
  return given.filter(Boolean);
}

/** Add XP (can be negative); returns { leveledUp, level } */
async function addXp(member, amount, sourceChannel) {
  if (!member) return { leveledUp: false, level: 0 };
  const u = store.user(member.guild.id, member.id);
  const before = u.level;
  u.xp = Math.max(0, u.xp + amount);
  const { level } = levelFromXp(u.xp);
  u.level = level;
  store.markDirty();
  if (level !== before) {
    const given = await syncLevelRoles(member, level);
    if (level > before) {
      const target = channel(member.guild, 'level_ups') || channel(member.guild, 'bot_commands') || sourceChannel;
      if (target) {
        const line = pick(LEVEL_UP).replace('{user}', `<@${member.id}>`).replace('{level}', level);
        const extra = given.length ? `\n🎁 New role: **${given.join(', ')}**` : '';
        target.send({ content: line + extra, allowedMentions: { users: [member.id] } }).catch(() => {});
      }
      return { leveledUp: true, level };
    }
  }
  return { leveledUp: false, level };
}

async function setLevel(member, level) {
  const u = store.user(member.guild.id, member.id);
  u.xp = totalXpForLevel(level);
  u.level = level;
  store.markDirty();
  await syncLevelRoles(member, level);
}

function init(client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot || !msg.member) return;
    const g = store.guild(msg.guild.id);
    const u = store.user(msg.guild.id, msg.author.id);
    u.messages++;
    if (NO_XP_KEYS.some((k) => g.channels[k] === msg.channel.id)) return;
    if ((g.channelRules[msg.channel.id] || []).some((r) => r.rule === 'no_xp' || r.rule === 'trap')) return;
    if (/(discord\.gg|discord(app)?\.com\/invite)\//i.test(msg.content)) return; // invite spam earns nothing

    const blocked = xpBlockReason(msg.author.id, u, msg.content);
    remember(msg.author.id, msg.content);
    if (blocked) return;
    u.lastXp = Date.now();
    await addXp(msg.member, xpFor(msg.content), msg.channel);
  });
}

function rankCard(member) {
  const { embed, progressBar } = require('../util/helpers');
  const u = store.user(member.guild.id, member.id);
  const { level, into, needed } = levelFromXp(u.xp);
  const g = store.guild(member.guild.id);
  const sorted = Object.entries(g.users).sort((a, b) => b[1].xp - a[1].xp);
  const pos = sorted.findIndex(([id]) => id === member.id) + 1;
  const next = ladder(member.guild).find((s) => s.level > level);
  const nextRole = next ? member.guild.roles.cache.get(next.roleId)?.name : null;
  return embed(config.color.purple)
    .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
    .setTitle(`Level ${level}`)
    .setDescription(`${progressBar(into, needed, 16)}\n**${into} / ${needed} XP** to level ${level + 1}${nextRole ? `\nNext role: **${nextRole}** at level ${next.level}` : ''}`)
    .addFields(
      { name: 'Rank', value: `#${pos || '—'}`, inline: true },
      { name: 'Total XP', value: `${u.xp}`, inline: true },
      { name: 'Messages', value: `${u.messages}`, inline: true },
      { name: 'Coins', value: `🪙 ${u.coins}`, inline: true },
      { name: 'Daily streak', value: `🔥 ${u.streak}`, inline: true },
      { name: 'Fish caught', value: `🎣 ${u.fish?.caught || 0}`, inline: true },
    );
}

module.exports = { init, addXp, setLevel, levelFromXp, xpForLevel, totalXpForLevel, rankCard, ladder, syncLevelRoles, xpBlockReason, remember, xpFor };
