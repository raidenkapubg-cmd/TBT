// The server blueprint that /setup builds.
// Layout: brand core everyone sees, opt-in game sections unlocked by self-roles,
// an earned insiders area, and a hidden staff area.
const { ChannelType } = require('discord.js');
const config = require('../config');

const B = config.brand;
const S = config.brandSlug;

// ---------------------------------------------------------------- roles
// Order = top to bottom in the role list (all placed below the bot's own role).
const roles = [
  // staff
  { key: 'admin', name: '👑 Admin', color: 0xe74c3c, hoist: true, perms: ['Administrator'] },
  {
    key: 'mod',
    name: '🛡️ Moderator',
    color: 0x3498db,
    hoist: true,
    perms: [
      'KickMembers', 'BanMembers', 'ManageMessages', 'ModerateMembers', 'ManageNicknames',
      'MoveMembers', 'MuteMembers', 'DeafenMembers', 'ManageThreads', 'ViewAuditLog',
    ],
  },
  { key: 'team', name: `🛠️ Team ${B}`, color: config.color.main, hoist: true, perms: ['ManageMessages', 'ManageEvents', 'MentionEveryone'] },
  { key: 'helper', name: '💡 Helper', color: 0x1abc9c, hoist: true, perms: ['ManageMessages', 'ModerateMembers'] },
  { key: 'welcome_squad', name: '🤝 Welcome Squad', color: 0xf39c12, hoist: false, perms: [] },

  // awards
  { key: 'skirmish_champ', name: '🏆 Skirmish Champion', color: 0xf1c40f, hoist: true },
  { key: 'setup_month', name: '🖥️ Setup of the Month', color: 0xe67e22, hoist: false },
  { key: 'clip_week', name: '🎬 Clip of the Week', color: 0xe91e63, hoist: false },
  { key: 'bot_slayer', name: '🗡️ Bot Slayer', color: 0x95a5a6, hoist: false },
  { key: 'biggest_l', name: '🫠 Biggest L', color: 0x7f8c8d, hoist: false },

  // earned via levels (see levelRoles below)
  { key: 'insider', name: `🌟 ${B} Insider`, color: 0xf5b041, hoist: false },
  { key: 'lvl_50', name: '🌌 Mythic', color: 0xff4fd8, hoist: true },
  { key: 'lvl_30', name: '👑 Legend', color: 0xf1c40f, hoist: true },
  { key: 'lvl_20', name: '💎 Elite', color: 0x9b59b6, hoist: true },
  { key: 'lvl_15', name: '⚔️ Veteran', color: 0x3498db, hoist: true },
  { key: 'lvl_10', name: '🔥 Regular', color: 0xe67e22, hoist: true },
  { key: 'lvl_5', name: '🎯 Rookie', color: 0x2ecc71, hoist: false },
  { key: 'lvl_1', name: '🌱 Fresh Spawn', color: 0x95a5a6, hoist: false },
];

// Level ladder: members keep only their highest level role.
const levelRoles = [
  { level: 1, key: 'lvl_1' },
  { level: 5, key: 'lvl_5' },
  { level: 10, key: 'lvl_10' },
  { level: 15, key: 'lvl_15' },
  { level: 20, key: 'lvl_20' },
  { level: 30, key: 'lvl_30' },
  { level: 50, key: 'lvl_50' },
];

// ---------------------------------------------------------------- self roles
// Max 5 categories (one select menu each = one message).
const selfRoleCategories = [
  {
    key: 'side',
    title: '⚔️ Pick a Side',
    blurb: 'The eternal war. Your messages earn points for your team in #pc-vs-mobile wars.',
    single: true,
    options: [
      { key: 'team_pc', name: '🖥️ Team PC', emoji: '🖥️', desc: 'Mouse, keyboard, superiority complex' },
      { key: 'team_mobile', name: '📱 Team Mobile', emoji: '📱', desc: 'Thumbs of steel, clutch on 3% battery' },
      { key: 'team_console', name: '🎮 Team Console', emoji: '🎮', desc: 'Couch, controller, peace' },
      { key: 'team_swiss', name: '🏳️ Switzerland', emoji: '🏳️', desc: 'Neutral. Watches the world burn.' },
    ],
  },
  {
    key: 'games',
    title: '🎮 Main Quest',
    blurb: 'What do you play? Each pick unlocks that game\'s chat, LFG and squad voice.',
    single: false,
    options: [
      { key: 'g_valorant', name: '🎯 Valorant', emoji: '🎯', desc: 'Unlocks the Valorant section' },
      { key: 'g_bgmi', name: '🔫 BGMI', emoji: '🔫', desc: 'Unlocks the Other Games section' },
      { key: 'g_cs2', name: '💣 CS2', emoji: '💣', desc: 'Unlocks the Other Games section' },
      { key: 'g_fortnite', name: '🪂 Fortnite', emoji: '🪂', desc: 'Unlocks the Other Games section' },
      { key: 'g_minecraft', name: '⛏️ Minecraft', emoji: '⛏️', desc: 'Unlocks the Other Games section' },
      { key: 'g_party', name: '🎉 Party Games', emoji: '🎉', desc: 'Among Us, Gartic, Skribbl & chaos' },
    ],
  },
  {
    key: 'gear',
    title: '🖱️ Gear Check',
    blurb: `Show off what kind of setup goblin you are. Own ${B} gear? Grab the owner badge.`,
    single: false,
    options: [
      { key: 'owner', name: `🔴 ${B} Owner`, emoji: '🔴', desc: `I rock ${B} gear` },
      { key: 'rgb_goblin', name: '🌈 RGB Goblin', emoji: '🌈', desc: 'If it doesn\'t glow, it doesn\'t go' },
      { key: 'minimal_monk', name: '🧘 Minimalist Monk', emoji: '🧘', desc: 'One mouse. One pad. Inner peace.' },
      { key: 'cable_chef', name: '🍝 Cable Spaghetti Chef', emoji: '🍝', desc: 'Cable management is a myth' },
      { key: 'budget_beast', name: '💸 Budget Beast', emoji: '💸', desc: 'Max performance, min rupees' },
      { key: 'endgame', name: '🚀 Endgame Chaser', emoji: '🚀', desc: 'Always one upgrade away' },
    ],
  },
  {
    key: 'vibe',
    title: '🎭 Vibe Check',
    blurb: 'Tell people who you are. Picking **Roast Me** lets King A roast you personally. Brave.',
    single: false,
    options: [
      { key: 'roast_me', name: '🔥 Roast Me', emoji: '🔥', desc: 'Opt in to personal roasts from King A' },
      { key: 'night_owl', name: '🦉 Night Owl', emoji: '🦉', desc: 'Online 2 AM, every AM' },
      { key: 'clip_farmer', name: '🎬 Clip Farmer', emoji: '🎬', desc: 'If it wasn\'t clipped, it didn\'t happen' },
      { key: 'debate_lord', name: '🗣️ Debate Lord', emoji: '🗣️', desc: 'Will argue about anything' },
      { key: 'tryhard', name: '😤 Certified Tryhard', emoji: '😤', desc: 'Casual? Never heard of it' },
      { key: 'lurker', name: '👀 Professional Lurker', emoji: '👀', desc: 'Reads everything. Says nothing.' },
    ],
  },
  {
    key: 'pings',
    title: '🔔 Ping Me For',
    blurb: 'Only get pinged for what you care about. No spam, promise.',
    single: false,
    options: [
      { key: 'p_announce', name: '📣 Big News', emoji: '📣', desc: 'Major announcements' },
      { key: 'p_drops', name: '🏷️ Drops & Deals', emoji: '🏷️', desc: 'Sales, codes, limited drops' },
      { key: 'p_events', name: '🏆 Events & Skirmish', emoji: '🏆', desc: 'Tournaments and event nights' },
      { key: 'p_giveaways', name: '🎁 Giveaways', emoji: '🎁', desc: 'Giveaway alerts' },
      { key: 'p_geartalk', name: '🎙️ Gear Talk', emoji: '🎙️', desc: 'Weekly setup & product sessions' },
      { key: 'p_gamenight', name: '🌙 Game Night', emoji: '🌙', desc: 'Saturday community game night' },
    ],
  },
];

const OTHER_GAME_ROLES = ['g_bgmi', 'g_cs2', 'g_fortnite', 'g_minecraft', 'g_party'];

// ---------------------------------------------------------------- channels
// access:
//   'public'    - everyone can see & chat
//   'readonly'  - everyone can see, only staff/bot can post
//   'staff'     - hidden, staff only
//   { roles: [...] } - hidden, visible only to these role keys (+ staff)
// banter: King A may join the conversation here
const T = ChannelType.GuildText;
const V = ChannelType.GuildVoice;

const categories = [
  {
    key: 'cat_stats',
    name: '📊 SERVER STATS',
    channels: [
      { key: 'stat_members', name: 'Members: …', type: V, access: 'stat' },
      { key: 'stat_humans', name: 'Humans: …', type: V, access: 'stat' },
      { key: 'stat_bots', name: 'Bots: …', type: V, access: 'stat' },
      { key: 'stat_boosts', name: 'Boosts: …', type: V, access: 'stat' },
    ],
  },
  {
    key: 'cat_start',
    name: '📌 START HERE',
    channels: [
      { key: 'welcome', name: '👋・welcome', access: 'readonly', topic: 'New faces land here. Say hi in #introductions!' },
      { key: 'rules', name: '📜・rules', access: 'readonly', topic: 'Read these. King A is watching.' },
      { key: 'about', name: `🔴・about-${S}`, access: 'readonly', topic: `Who we are and what ${B} is about.` },
      { key: 'self_roles', name: '🎭・self-roles', access: 'readonly', topic: 'Pick your side, your games, your vibe.' },
      { key: 'introductions', name: '🙋・introductions', access: 'public', slowmode: 30, topic: 'Main game, rank, setup, one fun fact. Go!' },
    ],
  },
  {
    key: 'cat_news',
    name: '📢 NEWS',
    channels: [
      { key: 'announcements', name: '📣・announcements', access: 'readonly' },
      { key: 'drops', name: '🏷️・deals-and-drops', access: 'readonly', topic: 'Discord-only codes, sales and limited drops.' },
      { key: 'event_news', name: '📅・events', access: 'readonly', topic: 'Game nights, Skirmish, Gear Talk. All the dates.' },
      { key: 'content', name: '📺・content-drops', access: 'readonly', topic: 'New videos, reels and creator content.' },
    ],
  },
  {
    key: 'cat_lounge',
    name: '💬 LOUNGE',
    channels: [
      { key: 'general', name: '💬・general', access: 'public', banter: true, topic: 'Main chat. King A lurks here.' },
      { key: 'memes', name: '😂・memes', access: 'public', banter: true },
      { key: 'clips', name: '🎬・clips', access: 'public', topic: 'Post your best plays. Best clip each week gets a role.' },
      { key: 'setups', name: '🖥️・setups', access: 'public', topic: 'Show your battlestation. Setup of the Month is picked here.' },
      { key: 'wars', name: '⚔️・pc-vs-mobile', access: 'public', banter: true, topic: 'The war never ends. /wars for standings.' },
      { key: 'qotd', name: '❓・question-of-the-day', access: 'public', topic: 'A new question every day.' },
      { key: 'hall_of_fame', name: '⭐・hall-of-fame', access: 'readonly', topic: 'Messages with 5+ ⭐ end up here forever.' },
      { key: 'level_ups', name: '🆙・level-ups', access: 'readonly', topic: 'Level-ups and new roles. Chat to climb — spam earns nothing.' },
      { key: 'bot_commands', name: '🤖・bot-commands', access: 'public', topic: 'Spam commands here.' },
    ],
  },
  {
    key: 'cat_arcade',
    name: '🕹️ ARCADE',
    channels: [
      { key: 'activities', name: '🕹️・game-room', access: 'readonly', topic: 'Start Discord games (Putt Party, Sketch Heads, Poker…) from the menu here.' },
      { key: 'wordle', name: '🟩・wordle', access: 'public', topic: 'Play the official Wordle with /wordle, then paste your result here for stats, streaks & XP.' },
      { key: 'games', name: '🧩・games', access: 'public', topic: '/play  /trivia  /wyr  /rps — have fun.' },
      { key: 'counting', name: '🔢・counting', access: 'public', topic: 'Count up one at a time. No double turns. Mess up = reset.' },
      { key: 'word_chain', name: '🔤・word-chain', access: 'public', topic: 'Next word must start with the last letter of the previous one.' },
      { key: 'game_room_1', name: '🕹️ Game Room 1', type: V, access: 'public' },
      { key: 'game_room_2', name: '🕹️ Game Room 2', type: V, access: 'public' },
    ],
  },
  {
    key: 'cat_gear',
    name: `🛠️ ${B.toUpperCase()} GEAR`,
    channels: [
      { key: 'product_talk', name: '🖱️・product-talk', access: 'public', topic: `Talk ${B} gear: reviews, settings, comparisons.` },
      { key: 'support', name: '🧰・support', access: 'public', topic: 'Product issues? Ask here, the team will help.' },
      { key: 'feedback', name: '💡・feedback-and-ideas', access: 'public', topic: 'Ideas for the server or products. Upvote what you like.' },
      { key: 'reviews', name: '⭐・member-reviews', access: 'public', slowmode: 120, topic: 'Honest reviews from owners. Best ones get featured.' },
    ],
  },
  {
    key: 'cat_events',
    name: '🏆 EVENTS',
    channels: [
      { key: 'event_chat', name: '🎪・event-chat', access: 'public' },
      { key: 'registrations', name: '📝・registrations', access: 'public', slowmode: 10 },
      { key: 'brackets', name: '🧾・brackets', access: 'readonly' },
      { key: 'event_lobby', name: '🎤 Event Lobby', type: V, access: 'public' },
      { key: 'match_1', name: '⚔️ Match Room 1', type: V, access: 'public', limit: 10 },
      { key: 'match_2', name: '⚔️ Match Room 2', type: V, access: 'public', limit: 10 },
    ],
  },
  {
    key: 'cat_valorant',
    name: '🎯 VALORANT',
    access: { roles: ['g_valorant'] },
    channels: [
      { key: 'valo_chat', name: '🎯・valo-chat', banter: true },
      { key: 'lfg_unrated', name: '🤝・lfg-unrated', slowmode: 15 },
      { key: 'lfg_ranked', name: '📈・lfg-ranked', slowmode: 15, topic: 'Post your rank + region + what you need.' },
      { key: 'valo_squad_1', name: '🔊 Squad 1', type: V, limit: 5 },
      { key: 'valo_squad_2', name: '🔊 Squad 2', type: V, limit: 5 },
      { key: 'valo_squad_3', name: '🔊 Squad 3', type: V, limit: 5 },
      { key: 'valo_squad_4', name: '🔊 Squad 4', type: V, limit: 5 },
    ],
  },
  {
    key: 'cat_other_games',
    name: '🎮 OTHER GAMES',
    access: { roles: OTHER_GAME_ROLES },
    channels: [
      { key: 'game_chat', name: '🎮・game-chat', banter: true, topic: 'BGMI, CS2, Fortnite, Minecraft, party games.' },
      { key: 'lfg', name: '🤝・lfg', slowmode: 15 },
      { key: 'squad_up_1', name: '🔊 Squad Up 1', type: V, limit: 5 },
      { key: 'squad_up_2', name: '🔊 Squad Up 2', type: V, limit: 5 },
    ],
  },
  {
    key: 'cat_insiders',
    name: '🌟 INSIDERS',
    access: { roles: ['insider', 'lvl_10', 'lvl_15', 'lvl_20', 'lvl_30', 'lvl_50'] },
    channels: [
      { key: 'insider_lounge', name: '🌟・insider-lounge', topic: 'Unlocked at level 10. Early peeks and priority drops.' },
      { key: 'beta_test', name: '🧪・beta-test', topic: 'Test new stuff early and tell us what you think.' },
    ],
  },
  {
    key: 'cat_voice',
    name: '🔊 HANGOUT',
    channels: [
      { key: 'create_vc', name: '➕ Create VC', type: V, access: 'public' },
      { key: 'hangout', name: '🛋️ Community Hangout', type: V, access: 'public' },
      { key: 'chill', name: '🎧 Chill', type: V, access: 'public' },
      { key: 'night_shift', name: '🌙 Night Shift', type: V, access: 'public' },
      { key: 'afk', name: '💤 AFK', type: V, access: 'public' },
    ],
  },
  {
    key: 'cat_staff',
    name: '🛡️ STAFF',
    access: 'staff',
    channels: [
      { key: 'console', name: '👑・king-a-console', topic: 'Talk to King A in plain English. No @ needed. e.g. "make a trap channel that bans anyone who posts for 7 days"' },
      { key: 'mod_chat', name: '🛡️・mod-chat' },
      { key: 'reports', name: '🚨・reports', topic: 'Member reports land here with action buttons.' },
      { key: 'server_logs', name: '📜・server-logs' },
      { key: 'message_logs', name: '📜・message-logs' },
      { key: 'leave_logs', name: '📜・leave-logs' },
      { key: 'bot_logs', name: '🤖・bot-logs', topic: 'Everything King A says on its own is logged here.' },
    ],
  },
];

// Channels where King A never speaks on its own.
const quietZones = new Set([
  'welcome', 'rules', 'about', 'self_roles', 'announcements', 'drops', 'event_news', 'content',
  'support', 'product_talk', 'feedback', 'reviews', 'registrations', 'brackets', 'hall_of_fame',
  'counting', 'word_chain', 'activities', 'mod_chat', 'console', 'reports', 'level_ups', 'server_logs', 'message_logs', 'leave_logs', 'bot_logs',
]);

module.exports = { roles, levelRoles, selfRoleCategories, categories, quietZones, OTHER_GAME_ROLES };
