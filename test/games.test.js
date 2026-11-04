process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'kinga-test-' + process.pid);
const test = require('node:test');
const assert = require('node:assert');
const wordle = require('../src/games/wordle');
const words = require('../src/games/words');
const fish = require('../src/games/fish');
const safety = require('../src/util/safety');
const giveaway = require('../src/commands/giveaway');

test('wordle scoring handles duplicate letters', () => {
  assert.deepStrictEqual(wordle.score('crane', 'crane'), [2, 2, 2, 2, 2]);
  assert.deepStrictEqual(wordle.score('speed', 'abide'), [0, 0, 1, 0, 1]);
  // two e's guessed, answer has one e in the right spot
  assert.deepStrictEqual(wordle.score('geese', 'those'), [0, 0, 0, 2, 2]);
  assert.deepStrictEqual(wordle.score('allee', 'apple'), [2, 1, 0, 0, 2]);
});

test('wordle game flow', () => {
  const g = wordle.newGame({ daily: false });
  g.answer = 'mouse';
  assert.ok(wordle.guess(g, 'zzzzz').error);
  assert.ok(wordle.guess(g, 'abc').error);
  assert.ok(!wordle.guess(g, 'house').error);
  assert.ok(wordle.guess(g, 'house').error, 'repeat guess rejected');
  wordle.guess(g, 'mouse');
  assert.ok(g.done && g.won);
  assert.ok(wordle.render(g).length > 1000, 'renders png');
  assert.match(wordle.emojiGrid(g), /🟩🟩🟩🟩🟩/);
});

test('all wordle answers are valid 5-letter words and daily word is stable', () => {
  assert.ok(words.ANSWERS.length > 400);
  for (const w of words.ANSWERS) assert.match(w, /^[a-z]{5}$/);
  assert.strictEqual(words.dailyWord('2026-11-04'), words.dailyWord('2026-11-04'));
  assert.ok(words.isValidGuess('crane'));
});

test('fishing: catches respect location and luck shifts rarity', () => {
  for (let n = 0; n < 200; n++) {
    const c = fish.catchFish({ rodKey: 'twig', locKey: 'pond' });
    assert.strictEqual(c.location, 'pond');
    assert.ok(c.value >= 1 && c.kg > 0);
  }
  const share = (rod) => {
    let rare = 0;
    for (let n = 0; n < 20000; n++) if (['epic', 'legendary', 'mythic'].includes(fish.rollRarity(fish.rodByKey(rod).luck, false).key)) rare++;
    return rare / 20000;
  };
  assert.ok(share('crown') > share('twig') * 2, 'better rod = more rare fish');
  assert.ok(!fish.canFishAt('twig', 'ocean'));
  assert.ok(fish.canFishAt('carbon', 'ocean'));
});

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
