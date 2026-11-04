// Server-management actions shared by slash commands and the plain-English admin brain.
const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
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


// Accept friendly permission names: "send messages", "view", "SEND_MESSAGES", "manageMessages"…
const PERM_ALIASES = {
  view: 'ViewChannel', see: 'ViewChannel', read: 'ViewChannel', viewchannel: 'ViewChannel',
  send: 'SendMessages', talk: 'SendMessages', chat: 'SendMessages', write: 'SendMessages', post: 'SendMessages',
  react: 'AddReactions', reactions: 'AddReactions', connect: 'Connect', join: 'Connect', speak: 'Speak',
  stream: 'Stream', video: 'Stream', attach: 'AttachFiles', files: 'AttachFiles', images: 'AttachFiles', upload: 'AttachFiles',
  embed: 'EmbedLinks', links: 'EmbedLinks', history: 'ReadMessageHistory', mention: 'MentionEveryone', everyone: 'MentionEveryone',
  threads: 'CreatePublicThreads', manage: 'ManageChannels', admin: 'Administrator', administrator: 'Administrator',
  externalemojis: 'UseExternalEmojis', emojis: 'UseExternalEmojis', slash: 'UseApplicationCommands', commands: 'UseApplicationCommands',
  voiceactivity: 'UseVAD', timeout: 'ModerateMembers', mute: 'MuteMembers', deafen: 'DeafenMembers', move: 'MoveMembers',
};
function permName(p) {
  const raw = String(p).trim();
  if (P[raw] !== undefined) return raw;
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  const exact = Object.keys(P).find((k) => k.toLowerCase() === key);
  if (exact) return exact;
  if (PERM_ALIASES[key]) return PERM_ALIASES[key];
  const first = Object.keys(PERM_ALIASES).find((k) => key.startsWith(k));
  if (first) return PERM_ALIASES[first];
  throw new Error(`Unknown permission "${p}".`);
}

async function resolveTarget(guild, ref) {
  if (!ref || /^@?everyone$/i.test(String(ref).trim())) return guild.roles.everyone;
  return resolveRole(guild, ref) || (await resolveMember(guild, ref));
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
    const guild = actor.guild;
    const kind = String(a.kind || 'text').toLowerCase();
    const type = kind.startsWith('voice') ? ChannelType.GuildVoice : kind.startsWith('cat') ? ChannelType.GuildCategory : kind.startsWith('forum') ? ChannelType.GuildForum : ChannelType.GuildText;
    const parent = type !== ChannelType.GuildCategory && a.category ? resolveChannel(guild, a.category, { category: true }) : null;
    const opts = { name: a.name, type, parent: parent?.id, reason: `by ${actor.user.tag}` };
    if (type === ChannelType.GuildText) {
      if (a.topic) opts.topic = String(a.topic).slice(0, 1024);
      if (a.slowmode) opts.rateLimitPerUser = Number(a.slowmode);
    }
    if (type === ChannelType.GuildVoice && a.user_limit) opts.userLimit = Number(a.user_limit);

    const visibleTo = [].concat(a.visible_to || []).map((r) => resolveRole(guild, r)).filter(Boolean);
    const ow = [{ id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.ManageMessages, P.Connect] }];
    if (a.private || visibleTo.length) {
      ow.push({ id: guild.roles.everyone.id, deny: [P.ViewChannel] });
      for (const r of visibleTo) ow.push({ id: r.id, allow: [P.ViewChannel, P.SendMessages, P.Connect, P.Speak] });
    }
    if (a.read_only) {
      const ev = ow.find((o) => o.id === guild.roles.everyone.id);
      if (ev) ev.deny = [...(ev.deny || []), P.SendMessages];
      else ow.push({ id: guild.roles.everyone.id, deny: [P.SendMessages] });
    }
    if (ow.length > 1) opts.permissionOverwrites = parent ? [...parent.permissionOverwrites.cache.map((o) => ({ id: o.id, allow: o.allow, deny: o.deny })).filter((o) => !ow.some((x) => x.id === o.id)), ...ow] : ow;
    const ch = await guild.channels.create(opts);
    return `📁 Created ${type === ChannelType.GuildCategory ? 'category' : 'channel'} ${type === ChannelType.GuildText ? `${ch}` : `**${ch.name}**`}${parent ? ` in **${parent.name}**` : ''}${visibleTo.length ? ` (visible to ${visibleTo.map((r) => r.name).join(', ')})` : a.private ? ' (private)' : ''}${a.read_only ? ' (read-only)' : ''}`;
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

  // ------------------------------------------------------------ channel settings & permissions
  async edit_channel(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel) || resolveChannel(actor.guild, a.channel, { category: true });
    if (!ch) throw new Error(`Couldn't find channel "${a.channel}".`);
    const edit = {};
    const done = [];
    if (a.name) { edit.name = a.name; done.push(`name → ${a.name}`); }
    if (a.topic !== undefined && 'topic' in ch) { edit.topic = String(a.topic).slice(0, 1024); done.push('topic'); }
    if (a.slowmode !== undefined) { edit.rateLimitPerUser = Math.max(0, Math.min(21600, Number(a.slowmode) || 0)); done.push(`slowmode ${edit.rateLimitPerUser}s`); }
    if (a.nsfw !== undefined) { edit.nsfw = !!a.nsfw; done.push(`age-restricted ${edit.nsfw ? 'on' : 'off'}`); }
    if (a.user_limit !== undefined) { edit.userLimit = Math.max(0, Math.min(99, Number(a.user_limit) || 0)); done.push(`user limit ${edit.userLimit || 'none'}`); }
    if (a.bitrate !== undefined) { edit.bitrate = Math.max(8000, Math.min(96000, Number(a.bitrate) * (Number(a.bitrate) < 1000 ? 1000 : 1))); done.push(`bitrate ${edit.bitrate / 1000}kbps`); }
    if (a.category) {
      const cat = resolveChannel(actor.guild, a.category, { category: true });
      if (!cat) throw new Error(`Couldn't find category "${a.category}".`);
      edit.parent = cat.id;
      done.push(`moved to ${cat.name}`);
    }
    if (a.position !== undefined) { edit.position = Number(a.position); done.push(`position ${edit.position}`); }
    if (!done.length) throw new Error('Tell me what to change (name, topic, slowmode, nsfw, user limit, bitrate, category).');
    await ch.edit(edit);
    return `⚙️ Updated **${ch.name}**: ${done.join(', ')}`;
  },
  async set_permissions(actor, a) {
    const guild = actor.guild;
    const ch = resolveChannel(guild, a.channel) || resolveChannel(guild, a.channel, { category: true });
    if (!ch) throw new Error(`Couldn't find channel "${a.channel}".`);
    const target = await resolveTarget(guild, a.target);
    if (!target) throw new Error(`Couldn't find role or member "${a.target}".`);
    const changes = {};
    for (const p of [].concat(a.allow || [])) changes[permName(p)] = true;
    for (const p of [].concat(a.deny || [])) changes[permName(p)] = false;
    for (const p of [].concat(a.reset || [])) changes[permName(p)] = null;
    if (!Object.keys(changes).length) throw new Error('Which permissions should I allow / deny?');
    await ch.permissionOverwrites.edit(target.id, changes, { reason: `by ${actor.user.tag}` });
    const fmt = (v) => Object.entries(changes).filter(([, x]) => x === v).map(([k]) => k);
    const parts = [];
    if (fmt(true).length) parts.push(`✅ ${fmt(true).join(', ')}`);
    if (fmt(false).length) parts.push(`⛔ ${fmt(false).join(', ')}`);
    if (fmt(null).length) parts.push(`↩️ ${fmt(null).join(', ')}`);
    return `🔐 Permissions for **${target.name || target.displayName}** in **${ch.name}**: ${parts.join(' · ')}`;
  },
  async sync_permissions(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel);
    if (!ch || !ch.parent) throw new Error('That channel isn\'t in a category.');
    await ch.lockPermissions();
    return `🔗 Synced **${ch.name}** permissions with **${ch.parent.name}**`;
  },

  // ------------------------------------------------------------ roles
  async edit_role(actor, a) {
    const r = resolveRole(actor.guild, a.role);
    if (!r) throw new Error(`Couldn't find role "${a.role}".`);
    if (!r.editable) throw new Error(`**${r.name}** is above my role.`);
    const edit = {};
    const done = [];
    if (a.name) { edit.name = a.name; done.push(`name → ${a.name}`); }
    if (a.color) { edit.color = parseColor(a.color); done.push(`colour ${a.color}`); }
    if (a.hoist !== undefined) { edit.hoist = !!a.hoist; done.push(`shown separately ${edit.hoist ? 'on' : 'off'}`); }
    if (a.mentionable !== undefined) { edit.mentionable = !!a.mentionable; done.push(`mentionable ${edit.mentionable ? 'on' : 'off'}`); }
    if (a.add_perms || a.remove_perms) {
      let perms = new PermissionsBitField(r.permissions);
      for (const p of [].concat(a.add_perms || [])) perms = perms.add(P[permName(p)]);
      for (const p of [].concat(a.remove_perms || [])) perms = perms.remove(P[permName(p)]);
      edit.permissions = perms;
      done.push('permissions');
    }
    if (!done.length) throw new Error('What should I change on the role?');
    await r.edit(edit);
    return `🎭 Updated **${r.name}**: ${done.join(', ')}`;
  },
  async move_role(actor, a) {
    const r = resolveRole(actor.guild, a.role);
    const ref = resolveRole(actor.guild, a.above || a.below);
    if (!r || !ref) throw new Error('I need the role to move and a role to put it above/below.');
    if (!r.editable) throw new Error(`**${r.name}** is above my role.`);
    const pos = a.above ? ref.position + (r.position < ref.position ? 0 : 1) : ref.position - (r.position > ref.position ? 0 : 1);
    await r.setPosition(Math.max(1, pos));
    return `↕️ Moved **${r.name}** ${a.above ? 'above' : 'below'} **${ref.name}**`;
  },
  async add_role_to_all(actor, a) {
    const r = resolveRole(actor.guild, a.role);
    if (!r || !r.editable) throw new Error(`I can't hand out "${a.role}".`);
    const filter = a.has_role ? resolveRole(actor.guild, a.has_role) : null;
    const members = await actor.guild.members.fetch();
    let n = 0;
    for (const m of members.values()) {
      if (m.user.bot || m.roles.cache.has(r.id) || (filter && !m.roles.cache.has(filter.id))) continue;
      await m.roles.add(r).then(() => n++).catch(() => {});
    }
    return `➕ Gave **${r.name}** to ${n} member${n === 1 ? '' : 's'}${filter ? ` with ${filter.name}` : ''}`;
  },
  async remove_role_from_all(actor, a) {
    const r = resolveRole(actor.guild, a.role);
    if (!r || !r.editable) throw new Error(`I can't manage "${a.role}".`);
    let n = 0;
    for (const m of r.members.values()) await m.roles.remove(r).then(() => n++).catch(() => {});
    return `➖ Removed **${r.name}** from ${n} member${n === 1 ? '' : 's'}`;
  },

  // ------------------------------------------------------------ server
  async edit_server(actor, a) {
    const levels = { none: 0, low: 1, medium: 2, high: 3, highest: 4, very_high: 4 };
    const edit = {};
    const done = [];
    if (a.name) { edit.name = a.name; done.push(`name → ${a.name}`); }
    if (a.verification_level !== undefined) {
      const v = levels[String(a.verification_level).toLowerCase()] ?? Number(a.verification_level);
      edit.verificationLevel = v;
      done.push(`verification ${a.verification_level}`);
    }
    if (a.afk_timeout_minutes) { edit.afkTimeout = Number(a.afk_timeout_minutes) * 60; done.push(`AFK timeout ${a.afk_timeout_minutes}m`); }
    if (a.afk_channel) {
      const ch = resolveChannel(actor.guild, a.afk_channel);
      if (ch) { edit.afkChannel = ch.id; done.push(`AFK channel ${ch.name}`); }
    }
    if (a.only_mentions !== undefined) { edit.defaultMessageNotifications = a.only_mentions ? 1 : 0; done.push(`default notifications: ${a.only_mentions ? 'mentions only' : 'all messages'}`); }
    if (!done.length) throw new Error('What server setting should I change?');
    await actor.guild.edit(edit);
    return `🏠 Server updated: ${done.join(', ')}`;
  },
  async create_invite(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel) || require('../util/helpers').channel(actor.guild, 'rules') || actor.guild.channels.cache.find((c) => c.isTextBased?.());
    const inv = await ch.createInvite({ maxAge: Math.round((Number(a.max_age_hours) || 0) * 3600), maxUses: Number(a.max_uses) || 0, unique: true, reason: `by ${actor.user.tag}` });
    return `🔗 Invite: ${inv.url}${a.max_age_hours ? ` (expires in ${a.max_age_hours}h)` : ' (never expires)'}${a.max_uses ? `, ${a.max_uses} uses` : ''}`;
  },

  // ------------------------------------------------------------ moderation extras
  async tempban(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    const why = canActOn(actor, m);
    if (why) throw new Error(why);
    return require('./guard').tempban(m, { days: Number(a.days) || 7, reason: a.reason || 'No reason', deleteDays: Number(a.delete_days ?? 1), by: actor.user.tag, hacked: !!a.hacked });
  },
  async softban(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    const why = canActOn(actor, m);
    if (why) throw new Error(why);
    return require('./guard').softban(m, { reason: a.reason || 'No reason', by: actor.user.tag });
  },
  async dm(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    await m.send(`📬 Message from the staff of **${actor.guild.name}**:\n${String(a.message).slice(0, 1800)}`);
    return `📬 DM sent to **${m.displayName}**`;
  },
  async set_channel_rule(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel);
    if (!ch) throw new Error(`Couldn't find channel "${a.channel}".`);
    const { rule, channel: _c, type: _t, ...opts } = a;
    if (opts.emojis && !Array.isArray(opts.emojis)) opts.emojis = String(opts.emojis).split(/[\s,]+/).filter(Boolean);
    for (const k of ['days', 'minutes', 'seconds', 'level']) if (opts[k] !== undefined) opts[k] = Number(opts[k]);
    const text = require('./guard').setRule(actor.guild, ch.id, { rule, ...opts });
    if (rule === 'trap') {
      await ch.send({ embeds: [require('../util/helpers').embed(0xe74c3c).setTitle('⛔ DO NOT POST HERE').setDescription(`Anything posted in this channel is treated as spam: the sender gets **${require('./guard').actionText(opts)}** automatically.\n\nThis channel exists to catch hacked accounts and spam bots.`)] }).catch(() => {});
    }
    return `📏 ${ch}: ${text}`;
  },
  async clear_channel_rules(actor, a) {
    const ch = resolveChannel(actor.guild, a.channel);
    if (!ch) throw new Error(`Couldn't find channel "${a.channel}".`);
    const n = require('./guard').clearRules(actor.guild, ch.id, a.rule);
    return `🧽 Removed ${n} rule${n === 1 ? '' : 's'} from ${ch}`;
  },
  async antispam(actor, a) {
    const g = store.guild(actor.guild.id);
    if (a.enabled !== undefined) g.antispam.enabled = !!a.enabled;
    if (a.block_invites !== undefined) g.antispam.blockInvites = !!a.block_invites;
    store.markDirty();
    return `🛡️ Anti-spam ${g.antispam.enabled ? 'ON' : 'OFF'} · invite blocking ${g.antispam.blockInvites ? 'ON' : 'OFF'}`;
  },
  async banter(actor, a) {
    const g = store.guild(actor.guild.id);
    g.banter.paused = !!a.paused;
    store.markDirty();
    return a.paused ? '⏸️ Banter paused' : '▶️ Banter on';
  },

  // ------------------------------------------------------------ levels
  async add_xp(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    const { level } = await require('./levels').addXp(m, Number(a.amount) || 0, null);
    return `✨ ${Number(a.amount) >= 0 ? 'Gave' : 'Took'} ${Math.abs(Number(a.amount) || 0)} XP ${Number(a.amount) >= 0 ? 'to' : 'from'} **${m.displayName}** (now level ${level})`;
  },
  async set_level(actor, a) {
    const m = await resolveMember(actor.guild, a.user);
    if (!m) throw new Error(`Couldn't find member "${a.user}".`);
    await require('./levels').setLevel(m, Math.max(0, Number(a.level) || 0));
    return `📈 Set **${m.displayName}** to level ${Number(a.level) || 0}`;
  },
  async set_level_role(actor, a) {
    const guild = actor.guild;
    const lvl = Number(a.level);
    if (!lvl) throw new Error('Which level?');
    let r = resolveRole(guild, a.role);
    if (!r && a.create !== false && a.role) r = await guild.roles.create({ name: a.role, color: parseColor(a.color), hoist: true, reason: `Level role by ${actor.user.tag}` });
    if (!r) throw new Error(`Couldn't find role "${a.role}".`);
    const g = store.guild(guild.id);
    const ladderNow = require('./levels').ladder(guild).filter((s) => s.level !== lvl && s.roleId !== r.id);
    g.levelRoles = [...ladderNow, { level: lvl, roleId: r.id }].sort((x, y) => x.level - y.level);
    store.markDirty();
    return `🪜 Level **${lvl}** now gives **${r.name}**. Ladder: ${g.levelRoles.map((s) => `${s.level}→${guild.roles.cache.get(s.roleId)?.name || '?'}`).join(', ')}`;
  },
  async remove_level_role(actor, a) {
    const guild = actor.guild;
    const g = store.guild(guild.id);
    g.levelRoles = require('./levels').ladder(guild).filter((s) => s.level !== Number(a.level));
    store.markDirty();
    return `🪜 Removed the level ${a.level} reward`;
  },
  async sync_level_roles(actor) {
    const levels = require('./levels');
    const g = store.guild(actor.guild.id);
    let n = 0;
    for (const [id, u] of Object.entries(g.users)) {
      const m = await actor.guild.members.fetch(id).catch(() => null);
      if (!m) continue;
      await levels.syncLevelRoles(m, u.level);
      n++;
    }
    return `🔄 Re-synced level roles for ${n} members`;
  },

  // ------------------------------------------------------------ reports
  async report(actor, a) {
    return require('./reports').build(actor.guild, a);
  },
};

const RISKY = new Set(['kick', 'ban', 'tempban', 'softban', 'delete_channel', 'delete_role', 'purge', 'setup', 'edit_server', 'add_role_to_all', 'remove_role_from_all', 'sync_level_roles']);

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

module.exports = { handlers, run, RISKY, describe, resolveMember, resolveRole, resolveChannel, canActOn, permName };
