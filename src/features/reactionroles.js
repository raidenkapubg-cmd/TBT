// Emoji reaction roles: one message per self-role category. React = get role, unreact = lose it.
const { Events } = require('discord.js');
const config = require('../config');
const store = require('../store');
const tpl = require('../setup/template');
const { embed, role, sleep } = require('../util/helpers');

const COLORS = [0xe74c3c, 0x3498db, 0xe67e22, 0x9b59b6, 0xf1c40f];

// Discord sometimes drops the U+FE0F variation selector from emoji names, so compare without it.
const norm = (e) => String(e || '').replace(/️/g, '');

function categoryEmbed(cat, idx) {
  return embed(COLORS[idx % COLORS.length])
    .setTitle(`${cat.title}${cat.single ? ' — pick ONE' : ''}`)
    .setDescription(
      [
        cat.blurb,
        '',
        ...cat.options.map((o) => `${o.emoji} **${o.name.replace(/^\S+\s/, '')}** — ${o.desc}`),
      ].join('\n'),
    );
}

/** Posts the header + one reaction message per category, and remembers which message is which. */
async function postPanels(channel) {
  const g = store.guild(channel.guild.id);
  g.reactionPanels = g.reactionPanels || {};
  await channel.send({
    embeds: [
      embed(config.color.purple)
        .setTitle('🎭 Build Your Character')
        .setDescription('React below to grab your roles. Remove your reaction to drop a role.\nChange your mind any time!'),
    ],
  });
  for (const [idx, cat] of tpl.selfRoleCategories.entries()) {
    const msg = await channel.send({ embeds: [categoryEmbed(cat, idx)] });
    g.reactionPanels[msg.id] = cat.key;
    store.markDirty();
    for (const o of cat.options) {
      await msg.react(o.emoji).catch((e) => console.error('[reactionroles] react failed', o.emoji, e.message));
      await sleep(250);
    }
  }
}

async function handle(reaction, user, added) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
  } catch {
    return;
  }
  const msg = reaction.message;
  if (!msg.guild) return;
  const g = store.guild(msg.guild.id);
  const catKey = g.reactionPanels?.[msg.id];
  if (!catKey) return;
  const cat = tpl.selfRoleCategories.find((c) => c.key === catKey);
  if (!cat) return;

  const option = cat.options.find((o) => norm(o.emoji) === norm(reaction.emoji.name));
  if (!option) {
    // Not one of ours — tidy it away
    if (added) await reaction.users.remove(user.id).catch(() => {});
    return;
  }
  const r = role(msg.guild, option.key);
  if (!r) return;
  const member = await msg.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  if (!added) {
    if (member.roles.cache.has(r.id)) await member.roles.remove(r).catch(() => {});
    return;
  }

  await member.roles.add(r).catch((e) => console.error('[reactionroles] add failed:', e.message));

  if (cat.single) {
    // Only one allowed: drop the other roles and the other reactions in this category
    for (const other of cat.options) {
      if (other.key === option.key) continue;
      const otherRole = role(msg.guild, other.key);
      if (otherRole && member.roles.cache.has(otherRole.id)) await member.roles.remove(otherRole).catch(() => {});
      const otherReaction = msg.reactions.cache.find((x) => norm(x.emoji.name) === norm(other.emoji));
      if (otherReaction) await otherReaction.users.remove(user.id).catch(() => {});
    }
  }
}

function init(client) {
  client.on(Events.MessageReactionAdd, (reaction, user) => handle(reaction, user, true));
  client.on(Events.MessageReactionRemove, (reaction, user) => handle(reaction, user, false));
}

module.exports = { init, postPanels, handle, norm };
