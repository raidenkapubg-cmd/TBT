process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'kinga-test-' + process.pid);
const test = require('node:test');
const assert = require('node:assert');
const safety = require('../src/util/safety');
const giveaway = require('../src/commands/giveaway');

test('safety filter', () => {
  assert.ok(safety.isSafe('your crosshair placement is a war crime'));
  assert.ok(!safety.isSafe('your mom plays better'));
  assert.ok(!safety.isSafe('hey @everyone'));
  assert.ok(safety.looksAngry('STOP IT RIGHT NOW BOT'));
  assert.ok(safety.looksAngry('stop, not funny'));
  assert.ok(!safety.looksAngry('lol good one'));
});

test('giveaway draw: unique winners, weighted', () => {
  const gw = { entrants: { a: 1, b: 5, c: 1 } };
  const w = giveaway.draw(gw, 3);
  assert.strictEqual(new Set(w).size, 3);
  let bWins = 0;
  for (let n = 0; n < 2000; n++) if (giveaway.draw(gw, 1)[0] === 'b') bWins++;
  assert.ok(bWins > 1200);
  assert.strictEqual(giveaway.parseDuration('2h'), 7200000);
  assert.strictEqual(giveaway.parseDuration('3d'), 259200000);
});

test('admin fallback parser understands simple requests', () => {
  const { Collection } = require('discord.js');
  const { fallbackParse } = require('../src/features/admin-ai');
  const target = { id: '222222222222222222' };
  const members = new Collection([['111111111111111111', { id: '111111111111111111' }], [target.id, target]]);
  const msg = { client: { user: { id: '111111111111111111' } }, mentions: { members, roles: new Collection() }, channel: { id: 'c1' } };
  assert.deepStrictEqual(fallbackParse(msg, 'remove <@222222222222222222> for spamming')[0].type, 'kick');
  assert.deepStrictEqual(fallbackParse(msg, 'ban <@222222222222222222>')[0].type, 'ban');
  assert.deepStrictEqual(fallbackParse(msg, 'mute <@222222222222222222> 15m')[0], { type: 'timeout', user: target.id, minutes: 15, reason: '15m' });
  assert.strictEqual(fallbackParse(msg, 'how are you'), null);
});

test('activity launcher builds the right invite and explains failures', async () => {
  const { ChannelType, InviteTargetType } = require('discord.js');
  const acts = require('../src/features/activities');
  assert.strictEqual(acts.find('g-act', 'putt party').id, '763133495793942528');
  assert.strictEqual(acts.find('g-act', 'sketch').name, 'Sketch Heads');
  assert.strictEqual(acts.find('g-act', 'nonsense-game'), null);

  let opts;
  const voice = { type: ChannelType.GuildVoice, toString: () => '#vc', createInvite: async (o) => ((opts = o), { url: 'https://discord.gg/abc' }) };
  const member = { voice: { channel: voice }, user: { tag: 'a#1' } };
  const guild = { id: 'g-act', channels: { cache: new Map() } };
  const res = await acts.launch(guild, member, 'chess');
  assert.strictEqual(res.url, 'https://discord.gg/abc');
  assert.strictEqual(opts.targetType, InviteTargetType.EmbeddedApplication);
  assert.strictEqual(opts.targetApplication, '832012774040141894');
  assert.strictEqual(acts.panel('g-act').components[0].toJSON().components[0].options.length <= 25, true);

  voice.createInvite = async () => { throw new Error('Unknown Application'); };
  await assert.rejects(acts.launch(guild, member, 'fishington'), /Activities/);

  const store = require('../src/store');
  store.guild('g-act').customActivities = { wordle: { name: 'Wordle', id: '123456789012345678', emoji: '🟩' } };
  assert.strictEqual(acts.find('g-act', 'wordle').id, '123456789012345678');
});

test('wordle tracker reads pasted results and the official daily recap', () => {
  const wt = require('../src/features/wordletracker');
  const now = new Date();
  const pasted = wt.parse({ author: { id: 'u1', bot: false }, content: 'Wordle 1,234 3/6\n⬛🟨⬛⬛🟩\n🟩🟩⬛🟩🟩\n🟩🟩🟩🟩🟩', createdAt: now });
  assert.deepStrictEqual(pasted.map((r) => [r.userId, r.score, r.puzzle]), [['u1', '3', '1234']]);
  assert.strictEqual(wt.parse({ author: { id: 'u1', bot: false }, content: 'I got wordle 3/6 today', createdAt: now }).length, 0, 'needs the emoji grid');
  const fail = wt.parse({ author: { id: 'u2', bot: false }, content: 'Wordle 1.235 X/6\n⬛⬛⬛⬛⬛', createdAt: now });
  assert.strictEqual(fail[0].score, 'X');

  const recap = wt.parse({
    author: { id: 'app', bot: true, username: 'Wordle' },
    content: 'Your group is on a 4 day streak! 🔥 Here are yesterday\'s results:\n👑 3/6: <@111111111111111111> <@222222222222222222>\n5/6: <@333333333333333333>\nX/6: <@444444444444444444>',
    createdAt: now, createdTimestamp: now.getTime(),
  });
  assert.deepStrictEqual(recap.map((r) => r.score), ['3', '3', '5', 'X']);
  assert.notStrictEqual(recap[0].day, pasted[0].day, 'recap counts for yesterday');

  // no double counting the same day
  assert.ok(wt.record('g-w', 'u1', pasted[0]));
  assert.ok(!wt.record('g-w', 'u1', { ...pasted[0], puzzle: '9999' }));
  assert.ok(wt.record('g-w', 'u1', { score: '4', day: recap[0].day, puzzle: null }));
  assert.strictEqual(wt.streak(require('../src/store').user('g-w', 'u1').wordleStats), 2);
  assert.strictEqual(wt.xpFor('3'), 60);
  assert.strictEqual(wt.xpFor('X'), 10);
});
