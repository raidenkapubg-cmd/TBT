// XP & levels: talk to level up; reward roles at 5 / 10 / 20; level 10 unlocks Insiders.
const { Events } = require('discord.js');
const config = require('../config');
const store = require('../store');
const { rand, channel, role, embed, pick } = require('../util/helpers');

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

const LEVEL_UP = [
  '{user} just hit **level {level}**! Keyboard warrior energy. ⚡',
  'GG {user}, **level {level}** unlocked. 🎉',
  '{user} ranked up to **level {level}**. The grind is real. 💪',
  'Level **{level}** for {user}! Someone get this person a better mousepad. 🖱️',
  '{user} is now **level {level}**. Touch grass? Never heard of it. 🌱',
];

async function grantRewards(member, level) {
  const granted = [];
  const map = { 5: 'rookie', 10: 'regular', 20: 'legend' };
  for (const [lvl, key] of Object.entries(map)) {
    if (level >= Number(lvl)) {
      const r = role(member.guild, key);
      if (r && !member.roles.cache.has(r.id)) {
        await member.roles.add(r).catch(() => {});
        granted.push(r.name);
      }
    }
  }
  if (level >= config.levels.insiderLevel) {
    const r = role(member.guild, 'insider');
    if (r && !member.roles.cache.has(r.id)) {
      await member.roles.add(r).catch(() => {});
      granted.push(r.name);
    }
  }
  return granted;
}

/** Add XP; returns { leveledUp, level } */
async function addXp(member, amount, sourceChannel) {
  const u = store.user(member.guild.id, member.id);
  const before = u.level;
  u.xp += amount;
  const { level } = levelFromXp(u.xp);
  u.level = level;
  store.markDirty();
  if (level > before) {
    const granted = await grantRewards(member, level);
    const target = channel(member.guild, 'bot_commands') || sourceChannel;
    if (target) {
      const line = pick(LEVEL_UP).replace('{user}', `<@${member.id}>`).replace('{level}', level);
      const extra = granted.length ? `\n🎁 Unlocked: **${granted.join(', ')}**` : '';
      target.send({ content: line + extra }).catch(() => {});
    }
    return { leveledUp: true, level };
  }
  return { leveledUp: false, level };
}

function init(client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot || !msg.member) return;
    const u = store.user(msg.guild.id, msg.author.id);
    u.messages++;
    const now = Date.now();
    if (now - u.lastXp < config.levels.cooldownMs) return;
    if (msg.content.length < 3) return;
    u.lastXp = now;
    await addXp(msg.member, rand(config.levels.xpMin, config.levels.xpMax), msg.channel);
  });
}

function rankCard(member) {
  const u = store.user(member.guild.id, member.id);
  const { level, into, needed } = levelFromXp(u.xp);
  const g = store.guild(member.guild.id);
  const sorted = Object.entries(g.users).sort((a, b) => b[1].xp - a[1].xp);
  const pos = sorted.findIndex(([id]) => id === member.id) + 1;
  const { progressBar } = require('../util/helpers');
  return embed(config.color.purple)
    .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
    .setTitle(`Level ${level}`)
    .setDescription(`${progressBar(into, needed, 16)}\n**${into} / ${needed} XP** to level ${level + 1}`)
    .addFields(
      { name: 'Rank', value: `#${pos || '—'}`, inline: true },
      { name: 'Total XP', value: `${u.xp}`, inline: true },
      { name: 'Messages', value: `${u.messages}`, inline: true },
      { name: 'Coins', value: `🪙 ${u.coins}`, inline: true },
      { name: 'Daily streak', value: `🔥 ${u.streak}`, inline: true },
      { name: 'Fish caught', value: `🎣 ${u.fish?.caught || 0}`, inline: true },
    );
}

module.exports = { init, addXp, levelFromXp, xpForLevel, rankCard };
