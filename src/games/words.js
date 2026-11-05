// English dictionary used by the word-chain channel.
let dict = null;

function isEnglishWord(w) {
  if (!dict) dict = new Set(require('an-array-of-english-words').filter((x) => /^[a-z]+$/.test(x)));
  return dict.has(String(w).toLowerCase());
}

module.exports = { isEnglishWord };
