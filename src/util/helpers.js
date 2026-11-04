const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const store = require('../store');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fill = (text, vars = {}) =>
  text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : k === 'brand' ? config.brand : m));

function embed(color = config.color.main) {
  return new EmbedBuilder().setColor(color);
}

function isStaff(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

function isMod(member) {
  if (!member) return false;
  return isStaff(member) || member.permissions.has(PermissionFlagsBits.ModerateMembers);
}

// Find a channel created by /setup by its key, falling back to a name match.
function channel(guild, key) {
  const g = store.guild(guild.id);
  const id = g.channels[key];
  if (id) {
    const ch = guild.channels.cache.get(id);
    if (ch) return ch;
  }
  return guild.channels.cache.find((c) => c.name.replace(/[^a-z0-9-]/gi, '').endsWith(key.replace(/[^a-z0-9-]/gi, ''))) || null;
}

function role(guild, key) {
  const g = store.guild(guild.id);
  const id = g.roles[key];
  if (id) {
    const r = guild.roles.cache.get(id);
    if (r) return r;
  }
  return null;
}

function hasRoleKey(member, key) {
  const r = role(member.guild, key);
  return r ? member.roles.cache.has(r.id) : false;
}

// Strip emoji prefixes like "💬 | general" -> "general" for matching
function plainName(name) {
  return name.replace(/^[^a-z0-9]*\|?\s*/i, '').toLowerCase();
}

async function log(guild, key, payload) {
  const ch = channel(guild, key);
  if (!ch || !ch.isTextBased()) return;
  try {
    await ch.send(payload);
  } catch {
    /* ignore */
  }
}

function todayKey(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: config.timezone });
}

function progressBar(value, max, size = 12) {
  const filled = Math.max(0, Math.min(size, Math.round((value / max) * size)));
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

module.exports = {
  pick,
  rand,
  sleep,
  fill,
  embed,
  isStaff,
  isMod,
  channel,
  role,
  hasRoleKey,
  plainName,
  log,
  todayKey,
  progressBar,
};
