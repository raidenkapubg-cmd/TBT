// Server-management actions shared by slash commands and the plain-English admin brain.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const store = require('../store');

const P = PermissionFlagsBits;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function resolveMember(guild, ref) {
  if (!ref) return null;
  const id = String(ref).match(/\d{15,21}/)?.[0];
  if (id) return guild.members.fetch(id).catch(() => null);
  const n = norm(ref);
  if (!n) return null;
  await guild.members.fetch({ query: String(ref).replace(/^@/, ''), limit: 5 }).catch(() => null);
  return (
    guild.members.cache.find((m) => norm(m.user.username) === n || norm(m.displayName) === n) ||
    guild.members.cache.find((m) => norm(m.displayName).includes(n) || norm(m.user.username).includes(n)) ||
    null
  );
}

function resolveRole(guild, ref) {
  if (!ref) return null;
  const id = String(ref).match(/\d{15,21}/)?.[0];
  if (id && guild.roles.cache.has(id)) return guild.roles.cache.get(id);
  const n = norm(ref);
  return (
    guild.roles.cache.find((r) => norm(r.name) === n) ||
    guild.roles.cache.find((r) => norm(r.name).includes(n) && n.length >= 3) ||
    null
  );
}

function resolveChannel(guild, ref, { category = false } = {}) {
  if (!ref) return null;
  const id = String(ref).match(/\d{15,21}/)?.[0];
  if (id && guild.channels.cache.has(id)) return guild.channels.cache.get(id);
  const n = norm(ref);
  const pool = guild.channels.cache.filter((c) => (category ? c.type === ChannelType.GuildCategory : c.type !== ChannelType.GuildCategory));
  return pool.find((c) => norm(c.name) === n) || pool.find((c) => norm(c.name).includes(n) && n.length >= 3) || null;
}

function canActOn(actor, target) {
  const guild = actor.guild;
  if (target.id === guild.ownerId) return 'I can\'t touch the server owner.';
  if (target.id === guild.members.me.id) return 'Nice try. I\'m not doing that to myself. 😏';
  if (actor.id !== guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) {
    return `${target.displayName} has a role equal to or higher than yours.`;
  }
  if (target.roles.highest.position >= guild.members.me.roles.highest.position) {
    return `${target.displayName}'s role is above mine — move my role higher in Server Settings → Roles.`;
  }
  return null;
}

function parseColor(c) {
  if (!c) return 0;
  const hex = String(c).replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return parseInt(hex, 16);
  const named = { red: 0xe74c3c, blue: 0x3498db, green: 0x2ecc71, yellow: 0xf1c40f, purple: 0x9b59b6, orange: 0xe67e22, pink: 0xe91e63, black: 0x23272a, white: 0xffffff, gold: 0xf1c40f, teal: 0x1abc9c };
  return named[String(c).toLowerCase()] || 0;
}

// Each handler returns a human-readable result string (or throws Error with a friendly message).
const handlers = {
  async kick(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    const why = canActOn(actor, m);
    if (why) throw new Error(why);
    await m.kick(`${a.reason || 'No reason'} — by ${actor.user.tag}`);
    return `👢 Kicked **${m.user.tag}**${a.reason ? ` — ${a.reason}` : ''}`;
  },
  async ban(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    const why = canActOn(actor, m);
    if (why) throw new Error(why);
    await m.ban({ reason: `${a.reason || 'No reason'} — by ${actor.user.tag}`, deleteMessageSeconds: Math.min(7, Number(a.delete_days) || 0) * 86400 });
    return `🔨 Banned **${m.user.tag}**${a.reason ? ` — ${a.reason}` : ''}`;
  },
  async unban(actor, a) {
    const id = String(a.user_id || a.user || '').match(/\d{15,21}/)?.[0];
    if (!id) throw new Error('I need the user ID to unban.');
    await actor.guild.members.unban(id, `by ${actor.user.tag}`);
    return `🕊️ Unbanned <@${id}>`;
  },
  async timeout(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    const why = canActOn(actor, m);
    if (why) throw new Error(why);
    const minutes = Math.max(1, Math.min(40320, Number(a.minutes) || 10));
    await m.timeout(minutes * 60000, `${a.reason || 'No reason'} — by ${actor.user.tag}`);
    return `🔇 Timed out **${m.displayName}** for ${minutes} min${a.reason ? ` — ${a.reason}` : ''}`;
  },
  async untimeout(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    await m.timeout(null);
    return `🔊 Removed timeout from **${m.displayName}**`;
  },
  async warn(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    const u = store.user(actor.guild.id, m.id);
    u.warns = u.warns || [];
    u.warns.push({ reason: a.reason || 'No reason', by: actor.id, at: Date.now() });
    store.markDirty();
    await m.send(`⚠️ You were warned in **${actor.guild.name}**: ${a.reason || 'No reason given'}`).catch(() => {});
    return `⚠️ Warned **${m.displayName}** (${u.warns.length} warning${u.warns.length === 1 ? '' : 's'} total)`;
  },
  async add_role(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    const r = resolveRole(actor.guild, a.role);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    if (!r) throw new Error(`Couldn't find role "${a.role}".`);
    if (!r.editable) throw new Error(`**${r.name}** is above my role, I can't give it.`);
    if (actor.id !== actor.guild.ownerId && r.position >= actor.roles.highest.position) throw new Error(`**${r.name}** is at or above your highest role.`);
    await m.roles.add(r);
    return `➕ Gave **${r.name}** to **${m.displayName}**`;
  },
  async remove_role(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    const r = resolveRole(actor.guild, a.role);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    if (!r) throw new Error(`Couldn't find role "${a.role}".`);
    if (!r.editable) throw new Error(`**${r.name}** is above my role.`);
    await m.roles.remove(r);
    return `➖ Removed **${r.name}** from **${m.displayName}**`;
  },
  async create_role(actor, a) {
    if (!a.name) throw new Error('What should the role be called?');
    const r = await actor.guild.roles.create({ name: a.name, color: parseColor(a.color), hoist: !!a.hoist, mentionable: !!a.mentionable, reason: `by ${actor.user.tag}` });
    return `🎭 Created role **${r.name}**`;
  },
  async delete_role(actor, a) {
    const r = resolveRole(actor.guild, a.role);
    if (!r) throw new Error(`Couldn't find role "${a.role}".`);
    if (!r.editable || r.managed) throw new Error(`I can't delete **${r.name}**.`);
    const name = r.name;
    await r.delete(`by ${actor.user.tag}`);
    return `🗑️ Deleted role **${name}**`;
  },
  async create_channel(actor, a) {
    if (!a.name) throw new Error('What should the channel be called?');
    const kind = String(a.kind || 'text').toLowerCase();
    const type = kind.startsWith('voice') ? ChannelType.GuildVoice : kind.startsWith('cat') ? ChannelType.GuildCategory : ChannelType.GuildText;
    const parent = type !== ChannelType.GuildCategory && a.category ? resolveChannel(actor.guild, a.category, { category: true }) : null;
    const opts = { name: a.name, type, parent: parent?.id, topic: type === ChannelType.GuildText ? a.topic : undefined, reason: `by ${actor.user.tag}` };
    if (a.private) {
      opts.permissionOverwrites = [
        { id: actor.guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: actor.guild.members.me.id, allow: [P.ViewChannel] },
      ];
    }
    const ch = await actor.guild.channels.create(opts);
    return `📁 Created ${type === ChannelType.GuildCategory ? 'category' : 'channel'} ${type === ChannelType.GuildText ? `${ch}` : `**${ch.name}**`}${parent ? ` in **${parent.name}**` : ''}`;
  },
  async delete_channel(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel) || resolveChannel(actor.guild, a.channel, { category: true });
    if (!ch) throw new Error(`Couldn't find channel "${a.channel}".`);
    if (!ch.deletable) throw new Error(`I can't delete **${ch.name}**.`);
    const name = ch.name;
    await ch.delete(`by ${actor.user.tag}`);
    return `🗑️ Deleted **${name}**`;
  },
  async rename_channel(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel) || resolveChannel(actor.guild, a.channel, { category: true });
    if (!ch) throw new Error(`Couldn't find channel "${a.channel}".`);
    const old = ch.name;
    await ch.setName(a.name);
    return `✏️ Renamed **${old}** → **${a.name}**`;
  },
  async move_channel(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel);
    const cat = resolveChannel(actor.guild, a.category, { category: true });
    if (!ch) throw new Error(`Couldn't find channel "${a.channel}".`);
    if (!cat) throw new Error(`Couldn't find category "${a.category}".`);
    await ch.setParent(cat.id, { lockPermissions: a.sync !== false });
    return `📦 Moved **${ch.name}** into **${cat.name}**`;
  },
  async sort_channels(actor, a) {
    const guild = actor.guild;
    const cats = a.category
      ? [resolveChannel(guild, a.category, { category: true })].filter(Boolean)
      : [...guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).values(), null];
    if (a.category && !cats.length) throw new Error(`Couldn't find category "${a.category}".`);
    let count = 0;
    const strip = (n) => n.replace(/^[^a-z0-9]+/i, '').toLowerCase();
    for (const cat of cats) {
      const kids = guild.channels.cache
        .filter((c) => c.parentId === (cat?.id ?? null) && c.type !== ChannelType.GuildCategory)
        .sort((x, y) => {
          const xv = x.isVoiceBased() ? 1 : 0;
          const yv = y.isVoiceBased() ? 1 : 0;
          return xv - yv || strip(x.name).localeCompare(strip(y.name));
        });
      const positions = [...kids.values()].map((c, i) => ({ channel: c.id, position: i }));
      if (positions.length) {
        await guild.channels.setPositions(positions);
        count += positions.length;
      }
    }
    return `🔤 Sorted ${count} channels A→Z${a.category ? ` in **${cats[0].name}**` : ''} (text first, then voice)`;
  },
  async lock(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel);
    if (!ch) throw new Error(`Couldn't find channel "${a.channel}".`);
    await ch.permissionOverwrites.edit(actor.guild.roles.everyone, { SendMessages: false, Connect: ch.isVoiceBased() ? false : null });
    const minutes = Number(a.minutes) || 0;
    if (minutes > 0) {
      setTimeout(() => ch.permissionOverwrites.edit(actor.guild.roles.everyone, { SendMessages: null, Connect: null }).catch(() => {}), minutes * 60000).unref();
    }
    await ch.send(`🔒 Channel locked by staff${minutes ? ` for ${minutes} min` : ''}.`).catch(() => {});
    return `🔒 Locked ${ch}${minutes ? ` for ${minutes} min` : ''}`;
  },
  async unlock(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel);
    if (!ch) throw new Error(`Couldn't find channel "${a.channel}".`);
    await ch.permissionOverwrites.edit(actor.guild.roles.everyone, { SendMessages: null, Connect: null });
    await ch.send('🔓 Channel unlocked.').catch(() => {});
    return `🔓 Unlocked ${ch}`;
  },
  async slowmode(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel);
    if (!ch || !ch.setRateLimitPerUser) throw new Error(`Couldn't find text channel "${a.channel}".`);
    const s = Math.max(0, Math.min(21600, Number(a.seconds) || 0));
    await ch.setRateLimitPerUser(s);
    return s ? `🐢 Slowmode in ${ch}: ${s}s` : `⚡ Slowmode off in ${ch}`;
  },
  async purge(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel);
    if (!ch || !ch.bulkDelete) throw new Error(`Couldn't find text channel "${a.channel}".`);
    const count = Math.max(1, Math.min(100, Number(a.count) || 10));
    let msgs = await ch.messages.fetch({ limit: 100 });
    if (a.user) {
      const m = await resolveMember(actor.guild, a.user);
      if (m) msgs = msgs.filter((x) => x.author.id === m.id);
    }
    const deleted = await ch.bulkDelete([...msgs.values()].slice(0, count), true);
    return `🧹 Deleted ${deleted.size} messages in ${ch}`;
  },
  async nick(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    const why = m.id === actor.guild.ownerId ? 'I can\'t change the owner\'s nickname.' : null;
    if (why) throw new Error(why);
    await m.setNickname(a.nickname || null);
    return `🏷️ ${a.nickname ? `Nicknamed **${m.user.username}** → **${a.nickname}**` : `Reset **${m.user.username}**'s nickname`}`;
  },
  async say(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel);
    if (!ch || !ch.isTextBased()) throw new Error(`Couldn't find text channel "${a.channel}".`);
    await ch.send({ content: String(a.message).slice(0, 2000), allowedMentions: { parse: ['users'] } });
    return `💬 Sent a message in ${ch}`;
  },
  async announce(actor, a) {
    const { embed } = require('../util/helpers');
    const ch = resolveChannel(actor.guild, a.channel) || require('../util/helpers').channel(actor.guild, 'announcements');
    if (!ch || !ch.isTextBased()) throw new Error('Couldn\'t find the announcement channel.');
    const role = a.ping_role ? resolveRole(actor.guild, a.ping_role) : null;
    const e = embed().setDescription(String(a.message || '').slice(0, 4000)).setTimestamp();
    if (a.title) e.setTitle(String(a.title).slice(0, 256));
    await ch.send({ content: role ? `<@&${role.id}>` : undefined, embeds: [e], allowedMentions: { roles: role ? [role.id] : [] } });
    return `📣 Announced in ${ch}${role ? ` (pinged ${role.name})` : ''}`;
  },
};

const RISKY = new Set(['kick', 'ban', 'delete_channel', 'delete_role', 'purge', 'setup']);

function describe(a) {
  const parts = Object.entries(a)
    .filter(([k]) => k !== 'type')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return `\`${a.type}\` ${parts}`;
}

async function run(actor, action) {
  const fn = handlers[action.type];
  if (!fn) throw new Error(`I don't know how to "${action.type}".`);
  return fn(actor, action);
}

module.exports = { handlers, run, RISKY, describe, resolveMember, resolveRole, resolveChannel, canActOn };
