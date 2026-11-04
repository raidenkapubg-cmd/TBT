// Locked voice channels showing live server numbers.
// Discord allows ~2 renames per channel per 10 minutes, so we update every 10 minutes and only on change.
const { Events } = require('discord.js');
const store = require('../store');

const fetched = new Set();

const fmt = (n) => n.toLocaleString('en-IN');

async function updateGuild(guild) {
  const g = store.guild(guild.id);
  if (!g.channels.stat_members) return;
  // Fetch the full member list once; the Server Members intent keeps the cache fresh after that.
  if (!fetched.has(guild.id)) {
    await guild.members.fetch().catch(() => null);
    fetched.add(guild.id);
  }
  const members = guild.members.cache;
  const bots = members.filter((m) => m.user.bot).size;
  const values = {
    stat_members: `👥 Members: ${fmt(guild.memberCount)}`,
    stat_humans: `🙋 Humans: ${fmt(guild.memberCount - bots)}`,
    stat_bots: `🤖 Bots: ${fmt(bots)}`,
    stat_boosts: `🚀 Boosts: ${fmt(guild.premiumSubscriptionCount || 0)}`,
  };
  for (const [key, name] of Object.entries(values)) {
    const ch = guild.channels.cache.get(g.channels[key]);
    if (ch && ch.name !== name) await ch.setName(name).catch(() => {});
  }
}

function init(client) {
  const tick = () => client.guilds.cache.forEach((g) => updateGuild(g).catch(() => {}));
  client.once(Events.ClientReady, () => {
    setTimeout(tick, 15000);
    setInterval(tick, 10 * 60 * 1000);
  });
}

module.exports = { init, updateGuild };
