// Wordle: 6 tries to guess a 5-letter word. Board rendered as an image.
const { createCanvas } = require('@napi-rs/canvas');
const { ANSWERS, isValidGuess, dailyWord } = require('./words');

/** Score a guess: 2 = right spot, 1 = in word, 0 = not in word (handles duplicate letters). */
function score(guess, answer) {
  const res = Array(5).fill(0);
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) res[i] = 2;
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] === 0 && left[guess[i]]) {
      res[i] = 1;
      left[guess[i]]--;
    }
  }
  return res;
}

const COLORS = { 2: '#538d4e', 1: '#b59f3b', 0: '#3a3a3c' };

function render(game) {
  const tile = 62;
  const gap = 8;
  const pad = 24;
  const boardW = 5 * tile + 4 * gap;
  const kbH = 3 * 44 + 2 * 6;
  const W = boardW + pad * 2;
  const H = pad + 6 * tile + 5 * gap + 24 + kbH + pad;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#121213';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      const x = pad + c * (tile + gap);
      const y = pad + r * (tile + gap);
      const g = game.guesses[r];
      if (g) {
        ctx.fillStyle = COLORS[g.score[c]];
        ctx.fillRect(x, y, tile, tile);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(g.word[c].toUpperCase(), x + tile / 2, y + tile / 2 + 2);
      } else {
        ctx.strokeStyle = '#3a3a3c';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, tile - 2, tile - 2);
      }
    }
  }

  // keyboard
  const status = {};
  for (const g of game.guesses) g.word.split('').forEach((ch, i) => (status[ch] = Math.max(status[ch] ?? -1, g.score[i])));
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const kw = (W - pad * 2 - 9 * 4) / 10;
  let y = pad + 6 * tile + 5 * gap + 24;
  for (const row of rows) {
    const rowW = row.length * kw + (row.length - 1) * 4;
    let x = (W - rowW) / 2;
    for (const ch of row) {
      const s = status[ch];
      ctx.fillStyle = s === undefined ? '#818384' : COLORS[s];
      ctx.fillRect(x, y, kw, 44);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(ch.toUpperCase(), x + kw / 2, y + 23);
      x += kw + 4;
    }
    y += 50;
  }
  return canvas.toBuffer('image/png');
}

function emojiGrid(game) {
  return game.guesses.map((g) => g.score.map((s) => (s === 2 ? '🟩' : s === 1 ? '🟨' : '⬛')).join('')).join('\n');
}

function newGame({ daily, dateKey }) {
  const answer = daily ? dailyWord(dateKey) : ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
  return { answer, guesses: [], daily: !!daily, dateKey, done: false, won: false, started: Date.now() };
}

/** Returns { error } or { game } after applying the guess */
function guess(game, word) {
  word = String(word || '').toLowerCase().trim();
  if (game.done) return { error: 'This game is over.' };
  if (!/^[a-z]{5}$/.test(word)) return { error: 'Guesses must be exactly 5 letters.' };
  if (!isValidGuess(word)) return { error: `**${word.toUpperCase()}** isn't in my word list.` };
  if (game.guesses.some((g) => g.word === word)) return { error: 'You already tried that word.' };
  const s = score(word, game.answer);
  game.guesses.push({ word, score: s });
  if (word === game.answer) {
    game.done = true;
    game.won = true;
  } else if (game.guesses.length >= 6) {
    game.done = true;
  }
  return { game };
}

module.exports = { score, render, emojiGrid, newGame, guess };
