// Word lists for Wordle and the word-chain channel.
let dict = null;
function dictionary() {
  if (!dict) {
    dict = new Set(require('an-array-of-english-words').filter((w) => /^[a-z]+$/.test(w)));
    for (const w of ANSWERS) dict.add(w);
  }
  return dict;
}

function isEnglishWord(w) {
  return dictionary().has(String(w).toLowerCase());
}

// Answers: common words everyone knows (plus some gaming/gear flavour).
const ANSWERS = `
about above actor acute admit adopt adult after again agent agree ahead alarm album alert alien align alike alive allow alone along alter angel anger angle angry apart apple apply arena argue arise armor array arrow aside asset audio avoid award aware awful bacon badge baker basic basin batch beach beast begin being below bench berry birth black blade blame blank blast blaze blend bless blind block blood bloom board boast bonus boost booth bound brain brake brand brave bread break brick bride brief bring broad brown brush buddy build bunch burst buyer cabin cable candy cargo carry catch cause chain chair chalk champ charm chart chase cheap check cheek chess chest chief child chill choir chord civic claim clash class clean clear click climb clock close cloud coach coast combo comet comic coral count court cover crack craft crash crazy cream crest crime crisp cross crowd crown crush curve cycle daily dance dealt death debut delay depth devil diary digit dizzy dodge doubt dough draft drain drama drawn dream dress drift drill drink drive drone eager eagle early earth eight elbow elite empty enemy enjoy enter entry equal error event every exact exist extra faith false fancy fatal fault feast fiber field fifth fight final first flame flash fleet flick float flood floor flour fluid focus force forge forth forum found frame fresh front frost fruit fully funny gamer ghost giant given glass glide globe glory glove grace grade grain grand grant graph grass great green greet grind grip group guard guess guest guide habit happy harsh heart heavy hello hinge hobby honey honor horse hotel house human humor ideal image index inner input issue ivory jelly jewel joint joker judge juice karma knife knock label labor laser later laugh layer learn lemon level lever light limit linen liver lobby local logic loose lover lower loyal lucky lunar lunch magic major maker mango maple march match maybe mayor medal media melon mercy merge merit metal meter might minor minus mixer model money month moral motor mount mouse mouth movie music naive nerve never night ninja noble noise north novel nurse ocean offer often olive onion opera orbit order other outer owner paint panel panic paper party pasta patch pause peace peach pearl pedal penny phase phone photo piano piece pilot pitch pixel pizza place plain plane plant plate plaza point polar porch pound power press price pride prime print prize proof proud prove pulse punch pupil queen query quest quick quiet quota quote radar radio raise rally ranch range rapid ratio reach react ready realm rebel reign relax relay reply rider ridge rifle right rival river roast robot rocky rogue round route royal rugby ruler rural salad sauce scale scene scope score scout screw seven shade shake shape share shark sharp sheep shelf shell shift shine shirt shock shoot short shout sight silly since skill skull slash sleep slice slide slope smart smile smoke snack snake solar solid solve sound south space spare spark speak speed spell spend spice spike spine spoon sport spray squad stack staff stage stain stake stand stare start state steam steel steep stick still stock stone storm story stove strap straw strip study style sugar suite sunny super surge swamp swift swing sword table taste teach tempo thank theme thick thief thing think third throw thumb tiger timer tired title toast token topic torch total touch tough tower toxic track trade trail train trait treat trend trial tribe trick troop truck truly trust truth tulip twist ultra uncle under union unity until upper upset urban usage usual valid value vapor vault video vigor viral virus visit vital vivid vocal voice wagon waste watch water weave wheel where which while white whole width windy witch woman world worry worth would wrist write wrong yield young youth zebra
`
  .trim()
  .split(/\s+/)
  .filter((w) => w.length === 5);

function isValidGuess(w) {
  return /^[a-z]{5}$/.test(w) && isEnglishWord(w);
}

function dailyWord(dateKey) {
  // deterministic per date
  let h = 2166136261;
  for (const c of `kinga-${dateKey}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ANSWERS[Math.abs(h) % ANSWERS.length];
}

module.exports = { ANSWERS, isValidGuess, isEnglishWord, dailyWord };
