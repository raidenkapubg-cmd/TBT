// Guardrails for anything the bot says on its own.
// Rule of thumb: never post anything you'd be unhappy to see screenshotted.

const BLOCKED = [
  // identity / real-life / appearance / family topics are off limits for banter
  /\b(religion|religious|caste|hindu|muslim|christian|sikh|jain|jew|allah|jesus)\b/i,
  /\b(gay|lesbian|trans|sexuality|sexual|sex|nude|horny|porn)\b/i,
  /\b(ugly|fat|skinny|bald|short king|face card|looks like)\b/i,
  /\b(your (mom|mother|dad|father|sister|brother|family|parents))\b/i,
  /\b(poor|broke|money|salary|rich kid)\b/i,
  /\b(race|racist|skin colou?r|dark skinned|fair skinned)\b/i,
  /\b(north indian|south indian|bihari|madrasi|chinki)\b/i,
  /\b(kill yourself|kys|die|suicide|retard|autis)/i,
  /\b(fuck|shit|bitch|bastard|cunt|dick|pussy|chutiya|madarchod|bhenchod|bc|mc|gandu|randi)\b/i,
];

function isSafe(text) {
  if (!text) return false;
  if (text.length > 400) return false;
  if (/@everyone|@here|<@&\d+>/.test(text)) return false;
  return !BLOCKED.some((re) => re.test(text));
}

// Detects a member getting genuinely annoyed so the bot can back off.
function looksAngry(text) {
  if (!text) return false;
  const letters = text.replace(/[^a-zA-Z]/g, '');
  const caps = letters.replace(/[^A-Z]/g, '').length;
  if (letters.length >= 8 && caps / letters.length > 0.8) return true;
  return /\b(stop|shut up|stfu|go away|leave me|not funny|annoying|block(ed)? you|mute|enough)\b/i.test(text);
}

function clean(text) {
  return (text || '')
    .replace(/@everyone|@here/g, '')
    .replace(/<@&\d+>/g, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

module.exports = { isSafe, looksAngry, clean };
