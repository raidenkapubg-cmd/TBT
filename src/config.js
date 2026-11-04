require('dotenv').config({ quiet: true });

const brand = (process.env.BRAND_NAME || 'Brand').trim();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  groqKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  brand,
  brandSlug: brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand',
  botName: 'King A',
  color: {
    main: 0xe2452d,
    good: 0x2ecc71,
    warn: 0xf1c40f,
    bad: 0xe74c3c,
    info: 0x5865f2,
    purple: 0x9b59b6,
  },

  // Banter guardrails
  banter: {
    dropInCooldownMs: 20 * 60 * 1000, // at most one drop-in per channel every 20 minutes
    dropInChance: 0.35, // chance to drop in once a chat is "active"
    activeWindowMs: 3 * 60 * 1000,
    activeMinMessages: 6,
    activeMinPeople: 2,
    followUpReplies: 3, // after dropping in, keep chatting for up to N replies
    perMemberDailyLimit: 3,
    newMemberDays: 7, // nobody gets roasted in their first 7 days
    backOffHours: 24,
    deadChatMinutes: 30,
  },

  levels: {
    xpMin: 15,
    xpMax: 25,
    cooldownMs: 60 * 1000,
    insiderLevel: 10,
  },
};
