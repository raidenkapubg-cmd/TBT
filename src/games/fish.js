// Fishing game data + pure logic (UI lives in commands/fish.js).

const RARITIES = [
  { key: 'common', name: 'Common', icon: '⚪', weight: 55 },
  { key: 'uncommon', name: 'Uncommon', icon: '🟢', weight: 25 },
  { key: 'rare', name: 'Rare', icon: '🔵', weight: 12 },
  { key: 'epic', name: 'Epic', icon: '🟣', weight: 5.5 },
  { key: 'legendary', name: 'Legendary', icon: '🟠', weight: 2 },
  { key: 'mythic', name: 'Mythic', icon: '🔴', weight: 0.5 },
];

const RODS = [
  { key: 'twig', name: 'Twig Rod', icon: '🪵', price: 0, luck: 0, window: 2200 },
  { key: 'bamboo', name: 'Bamboo Rod', icon: '🎋', price: 250, luck: 1, window: 2500 },
  { key: 'fiberglass', name: 'Fiberglass Rod', icon: '🎣', price: 1200, luck: 2, window: 2800 },
  { key: 'carbon', name: 'Carbon Pro Rod', icon: '⚡', price: 4500, luck: 3, window: 3000 },
  { key: 'mythril', name: 'Mythril Rod', icon: '💠', price: 15000, luck: 4.5, window: 3300 },
  { key: 'crown', name: 'King\'s Crown Rod', icon: '👑', price: 50000, luck: 6, window: 3600 },
];

// [name, emoji, base value, min kg, max kg]
const LOCATIONS = [
  {
    key: 'pond',
    name: 'Mossy Pond',
    icon: '🪷',
    needs: 'twig',
    fish: {
      common: [['Minnow', '🐟', 4, 0.1, 0.4], ['Pond Perch', '🐟', 6, 0.2, 0.8], ['Old Boot', '🥾', 1, 0.5, 1]],
      uncommon: [['Bluegill', '🐠', 14, 0.3, 1.2], ['Frog Prince', '🐸', 18, 0.1, 0.3]],
      rare: [['Koi', '🎏', 45, 1, 4], ['Snapping Turtle', '🐢', 60, 3, 12]],
      epic: [['Ghost Carp', '👻', 140, 4, 10]],
      legendary: [['Lotus Guardian', '🪷', 420, 8, 20]],
      mythic: [['The Pond King', '👑', 1500, 20, 40]],
    },
  },
  {
    key: 'river',
    name: 'Rapid River',
    icon: '🏞️',
    needs: 'bamboo',
    fish: {
      common: [['Trout', '🐟', 9, 0.5, 2], ['Chub', '🐟', 8, 0.4, 1.5], ['Tin Can', '🥫', 1, 0.1, 0.3]],
      uncommon: [['Rainbow Trout', '🌈', 24, 1, 3], ['Catfish', '🐱', 28, 2, 8]],
      rare: [['Mahseer', '🐡', 80, 5, 20], ['Electric Eel', '⚡', 95, 2, 6]],
      epic: [['Golden Mahseer', '🌟', 230, 10, 30]],
      legendary: [['River Serpent', '🐍', 650, 20, 60]],
      mythic: [['Rapid Spirit', '🌊', 2200, 30, 80]],
    },
  },
  {
    key: 'ocean',
    name: 'Coral Coast',
    icon: '🏝️',
    needs: 'fiberglass',
    fish: {
      common: [['Sardine', '🐟', 12, 0.1, 0.3], ['Mackerel', '🐟', 15, 0.5, 2], ['Seaweed Clump', '🌿', 2, 0.2, 1]],
      uncommon: [['Clownfish', '🐠', 35, 0.1, 0.3], ['Pufferfish', '🐡', 40, 0.5, 2]],
      rare: [['Swordfish', '🗡️', 130, 40, 120], ['Octopus', '🐙', 150, 3, 15]],
      epic: [['Manta Ray', '🦈', 380, 100, 300]],
      legendary: [['Great White', '🦈', 1000, 500, 1100]],
      mythic: [['Coral Leviathan', '🐉', 3500, 1000, 3000]],
    },
  },
  {
    key: 'deep',
    name: 'Midnight Trench',
    icon: '🌑',
    needs: 'carbon',
    fish: {
      common: [['Lanternfish', '🏮', 20, 0.1, 0.4], ['Hatchetfish', '🐟', 22, 0.1, 0.3]],
      uncommon: [['Gulper Eel', '🦎', 60, 1, 4], ['Vampire Squid', '🦑', 70, 0.5, 2]],
      rare: [['Anglerfish', '🔦', 210, 2, 10], ['Giant Isopod', '🪳', 180, 1, 2]],
      epic: [['Colossal Squid', '🦑', 600, 200, 500]],
      legendary: [['Abyss Watcher', '👁️', 1600, 300, 800]],
      mythic: [['The Kraken', '🐙', 6000, 2000, 6000]],
    },
  },
  {
    key: 'volcano',
    name: 'Magma Lagoon',
    icon: '🌋',
    needs: 'mythril',
    fish: {
      common: [['Ember Minnow', '🔥', 35, 0.2, 0.6], ['Ash Perch', '🐟', 38, 0.5, 1.5]],
      uncommon: [['Lava Eel', '🌋', 90, 2, 6], ['Obsidian Crab', '🦀', 110, 1, 3]],
      rare: [['Magma Koi', '🎏', 320, 4, 12], ['Phoenix Tetra', '🐦‍🔥', 380, 0.5, 2]],
      epic: [['Molten Ray', '☄️', 900, 50, 150]],
      legendary: [['Inferno Wyrm', '🐲', 2500, 400, 1200]],
      mythic: [['Heart of the Volcano', '❤️‍🔥', 9000, 1000, 3000]],
    },
  },
];

const MUTATIONS = [
  { name: 'Golden', icon: '🌟', chance: 0.015, mult: 5 },
  { name: 'Albino', icon: '🤍', chance: 0.02, mult: 3 },
  { name: 'Shiny', icon: '✨', chance: 0.06, mult: 2 },
];

const rodByKey = (k) => RODS.find((r) => r.key === k) || RODS[0];
const locByKey = (k) => LOCATIONS.find((l) => l.key === k) || LOCATIONS[0];
const rodRank = (k) => RODS.findIndex((r) => r.key === k);

function canFishAt(rodKey, locKey) {
  return rodRank(rodKey) >= rodRank(locByKey(locKey).needs);
}

function rollRarity(luck, perfect, rng = Math.random) {
  // Rarer tiers scale harder with luck. A perfect reel counts as +0.75 luck.
  const L = luck + (perfect ? 0.75 : 0);
  const scale = [0, 0.15, 0.3, 0.6, 0.8, 1.0];
  const weights = RARITIES.map((r, i) => r.weight * (1 + scale[i] * L));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return RARITIES[i];
  }
  return RARITIES[0];
}

function catchFish({ rodKey, locKey, perfect = false, rng = Math.random }) {
  const rod = rodByKey(rodKey);
  const loc = locByKey(locKey);
  const rarity = rollRarity(rod.luck, perfect, rng);
  const pool = loc.fish[rarity.key];
  const [name, emoji, base, minKg, maxKg] = pool[Math.floor(rng() * pool.length)];
  const kg = +(minKg + (maxKg - minKg) * rng() ** 1.6).toFixed(2);
  const sizeMult = 0.8 + 0.6 * ((kg - minKg) / Math.max(0.01, maxKg - minKg));
  let mutation = null;
  for (const m of MUTATIONS) {
    if (rng() < m.chance) {
      mutation = m;
      break;
    }
  }
  const value = Math.max(1, Math.round(base * sizeMult * (mutation ? mutation.mult : 1) * (perfect ? 1.15 : 1)));
  return { id: `${loc.key}:${name}`, name, emoji, rarity: rarity.key, kg, value, mutation: mutation?.name || null, location: loc.key };
}

function totalSpecies() {
  return LOCATIONS.reduce((n, l) => n + Object.values(l.fish).reduce((a, p) => a + p.length, 0), 0);
}

module.exports = { RARITIES, RODS, LOCATIONS, MUTATIONS, rodByKey, locByKey, rodRank, canFishAt, rollRarity, catchFish, totalSpecies };
