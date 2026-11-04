# 👑 King A

An all-in-one Discord bot that **builds and runs your whole server**: one-command setup, plain-English admin control, a banter personality, games, levels and more.

## What it does

| Area | Features |
| --- | --- |
| 🏗️ **Setup** | `/setup` builds the entire server: categories, channels, permissions, roles, rules, self-roles panel, AutoMod, verification and stats channels. `fresh` mode wipes and rebuilds; `add` mode only fills in what's missing. |
| 🗣️ **Plain-English admin** | Staff mention the bot: *"@King A remove @user for spam"*, *"create a voice channel called Scrims in Events"*, *"sort the channels"*, *"lock general for 10 minutes"*. Kicks, bans and deletes ask for a confirm click. |
| 🛡️ **Moderation** | `/mod` kick · ban · unban · timeout · warn · warnings · purge · nick, `/channel` create · delete · rename · move · sort · lock · slowmode, `/role` add · remove · create · delete, `/announce`, plus message, leave and server logs. |
| 🔥 **Banter** | Joins active chats at random for a few messages, replies when mentioned, opt-in personal roasts (**Roast Me** role), comeback battles with voting, hot takes, and a dead-chat reviver. Guardrails: gameplay-only topics, cooldowns, no roasts in a member's first week, backs off when someone's annoyed, `/banter pause` kill switch, and everything is logged. |
| 👋 **Welcome** | Generated welcome card image with a random funny line, a 👋 Wave counter, an icebreaker button and a link to roles. |
| 🎭 **Self-roles** | Emoji reaction roles, 5 categories: Pick a Side · Main Quest (unlocks game sections) · Gear Check · Vibe Check · Ping Me For. |
| 🎮 **Games** | `/wordle` (daily + practice, image board), `/fish` (cast, reel, rarities, variants, rods, locations, index), `/trivia`, `/wyr`, `/rps`, `/8ball`, plus counting and word-chain channels and first-to-type races. |
| 📈 **Progress** | XP and levels with reward roles at 5 / 10 / 20, Insiders area unlocked at level 10, `/rank`, `/leaderboard`, `/daily` streaks, coins, PC vs Mobile `/wars`, a ⭐ hall of fame, and `/award` roles. |
| 🎁 **Giveaways** | Button entry, extra tickets for higher levels, minimum level and account-age rules, re-roll. |
| ⏰ **Schedule** | Question of the day (6 PM), hot takes (1:30 PM & 8:30 PM), Monday game-night poll, monthly war results, and live member-count channels. |

## Setup

### 1. Discord Developer Portal
1. Open https://discord.com/developers/applications → your app → **Bot**.
2. Turn **ON** these two Privileged Gateway Intents:
   - **Server Members Intent**
   - **Message Content Intent**
3. Invite the bot with Administrator permission:
   `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands`
4. In the server: **Server Settings → Roles**, drag the **King A** role to the **top**.

### 2. Run it
Requires **Node.js 18.17+**.

```bash
npm install
cp .env.example .env   # then fill in DISCORD_TOKEN, CLIENT_ID, GROQ_API_KEY, BRAND_NAME
npm start
```

Then in your server, run **`/setup`**.

### 3. Optional: AI
Set `GROQ_API_KEY` to enable smart banter, plain-English admin commands and AI-generated questions. Without it, King A uses its built-in line bank and a simple command parser.

## Scripts
- `npm start` — run the bot
- `npm test` — unit tests, including a full `/setup` run against a fake server
- `npm run check` — validate every slash command without connecting to Discord

## Project layout
```
src/
  index.js          client, command loader, interaction router
  config.js         settings and banter guardrail numbers
  store.js          JSON database (data/db.json)
  setup/            server template, posted content, setup builder
  commands/         slash commands
  features/         welcome, logs, levels, banter, admin brain, stats, temp VCs, starboard, schedulers
  games/            wordle and fishing logic
  util/             helpers, Groq client, safety filter
```

Data is saved to `data/db.json`. Back it up if you move hosts.
