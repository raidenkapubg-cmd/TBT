process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'kinga-console-' + process.pid);
process.env.GROQ_API_KEY = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { Collection, ChannelType } = require('discord.js');
const groq = require('../src/util/groq');
const store = require('../src/store');

test('console turns plain English into chained actions', async () => {
  // Pretend the AI understood: "make a channel called dont-post-here that bans anyone who posts for 7 days"
  groq.chatJson = async () => ({
    reply: 'Trap set! 🪤',
    actions: [
      { type: 'create_channel', name: 'dont-post-here', kind: 'text', topic: 'Do not post' },
      { type: 'set_channel_rule', channel: 'dont-post-here', rule: 'trap', action: 'tempban', days: 7 },
    ],
  });
  const channels = new Collection();
  const sent = [];
  const guild = {
    id: 'g-console', name: 'T', ownerId: 'owner',
    roles: { everyone: { id: 'g-console' }, cache: new Collection() },
    members: { me: { id: 'bot' } },
    channels: {
      cache: channels,
      create: async (o) => {
        const ch = { id: 'c' + channels.size, name: o.name, type: o.type, send: async (p) => sent.push(p), toString: () => `#${o.name}` };
        channels.set(ch.id, ch);
        return ch;
      },
    },
  };
  const replies = [];
  const member = { id: 'admin', guild, user: { tag: 'admin#1' } };
  const msg = {
    id: 'm1', guild, member, author: { id: 'admin' }, client: { user: { id: 'bot' } },
    content: 'make a channel called dont-post-here that bans anyone who posts for 7 days',
    mentions: { members: new Collection(), roles: new Collection(), channels: new Collection() },
    channel: { id: 'console', name: 'king-a-console', sendTyping: async () => {}, send: async () => {} },
    reply: async (p) => replies.push(p),
  };
  const handled = await require('../src/features/admin-ai').handle(msg, { inConsole: true });
  assert.ok(handled);
  const ch = channels.find((c) => c.name === 'dont-post-here');
  assert.ok(ch, 'channel created');
  assert.strictEqual(ch.type, ChannelType.GuildText);
  assert.deepStrictEqual(store.guild('g-console').channelRules[ch.id][0], { rule: 'trap', action: 'tempban', days: 7 });
  assert.ok(sent.length, 'warning banner posted in the trap channel');
  assert.match(replies[0].content, /Trap set!/);
  assert.match(replies[0].content, /Trap/);
  assert.strictEqual(store.guild('g-console').console.length, 2, 'conversation remembered');
});

test('risky console actions wait for a confirm click', async () => {
  groq.chatJson = async () => ({ reply: 'Banning them.', actions: [{ type: 'tempban', user: '123456789012345678', days: 7 }] });
  const replies = [];
  const guild = { id: 'g2', channels: { cache: new Collection() }, roles: { cache: new Collection() } };
  const msg = {
    id: 'm2', guild, member: { displayName: 'a' }, author: { id: 'admin' }, client: { user: { id: 'bot' } }, content: 'tempban that guy',
    mentions: { members: new Collection(), roles: new Collection(), channels: new Collection() },
    channel: { id: 'x', name: 'console', sendTyping: async () => {} },
    reply: async (p) => replies.push(p),
  };
  await require('../src/features/admin-ai').handle(msg, { inConsole: true });
  assert.ok(replies[0].components?.length, 'confirm buttons shown');
});
