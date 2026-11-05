# 👑 King A

An all-in-one Discord bot that **builds and runs your whole server**: one-command setup, plain-English admin control, a banter personality, games, levels and more.

## What it does

| Area | Features |
| --- | --- |
| 🏗️ **Setup** | `/setup` builds the entire server: categories, channels, permissions, roles, rules, self-roles panel, AutoMod, verification and stats channels. `fresh` mode wipes and rebuilds; `add` mode only fills in what's missing. |
| 👑 **Console** | A private `#king-a-console` channel: admins type in plain English, no @ needed, and King A does it — channels, settings, permissions, roles, bans, XP, reports, custom channel rules. It remembers the conversation for follow-ups. `/console` creates it on any server. |
| 🧭 **`/setup2`** | Reorganize an **existing** server without wiping it: matches current channels/categories/roles by name, renames + moves + fixes permissions (messages kept), hides unused channels in a staff-only 🗄️ ARCHIVE, keeps private/voice/info/active ones, creates only what's missing. Shows the full plan first (`plan.txt`), takes `hide:` / `keep:` / `inactive_days:` / `keep_names:`, and `/setup2 mode:Undo` restores everything. |
| 🗣️ **Plain-English admin** | Or mention the bot anywhere: *"@King A remove @user for spam"*, *"create a voice channel called Scrims in Events"*, *"sort the channels"*, *"lock general for 10 minutes"*. Kicks, bans and deletes ask for a confirm click. |
| 🛡️ **Moderation** | `/mod` kick · ban · unban · timeout · warn · warnings · purge · nick, `/channel` create · delete · rename · move · sort · lock · slowmode, `/role` add · remove · create · delete, `/announce`, plus message, leave and server logs. |
| 🪤 **Channel rules** | Give any channel behaviour: **trap** (anyone who posts is temp-banned for N days, messages wiped, DM'd a rejoin link — catches hacked accounts), media-only, text-only, no links, auto-delete, auto-react, auto-thread, no XP, one post each, level gate. Via the console or `/channelrule`. |
| 🛡️ **Anti-spam** | Flood detection (timeout), same message across 3+ channels = likely hacked account (wiped + 24h timeout + staff alert), invite-link blocking, temp bans that lift themselves. Members can `/report` users or right-click → **Report message**; reports reach staff with action buttons. |
| 🔥 **Banter** | Joins active chats at random for a few messages, replies when mentioned, opt-in personal roasts (**Roast Me** role), comeback battles with voting, hot takes, and a dead-chat reviver. Guardrails: gameplay-only topics, cooldowns, no roasts in a member's first week, backs off when someone's annoyed, `/banter pause` kill switch, and everything is logged. |
| 👋 **Welcome** | Generated welcome card image with a random funny line, a 👋 Wave counter, an icebreaker button and a link to roles. |
| 🎭 **Self-roles** | Emoji reaction roles, 5 categories: Pick a Side · Main Quest (unlocks game sections) · Gear Check · Vibe Check · Ping Me For. |
| 🎮 **Games** | Discord's **official** games: `/play` (or the 🕹️ Game Room menu) starts Putt Party, Sketch Heads, Poker Night, Chess, SpellCast, Watch Together and more in a voice channel. `/activity add` adds any other Activity by ID. Official **Wordle** is played with its own `/wordle`; paste results in the wordle channel for stats, streaks, XP and `/wordlestats`. Plus `/trivia`, `/wyr`, `/rps`, `/8ball`, counting, word-chain and first-to-type races. |
| 📈 **Progress** | Spam-proof XP (short, repeated or flooded messages earn nothing). Level roles at 1 / 5 / 10 / 15 / 20 / 30 / 50 — members keep only their highest, ladder editable from the console. Insiders unlocked at level 10, `/levels`, `/rank`, `/leaderboard`, `/daily` streaks, coins, PC vs Mobile `/wars`, a ⭐ hall of fame, and `/award` roles. |
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
  games/            word list for the word-chain channel
  util/             helpers, Groq client, safety filter
```

Data is saved to `data/db.json`. Back it up if you move hosts.
