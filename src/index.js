const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Events, ActivityType, MessageFlags } = require('discord.js');
const config = require('./config');

if (!config.token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged: enable "Server Members Intent" in the Developer Portal
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: enable "Message Content Intent"
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
  allowedMentions: { parse: ['users'], repliedUser: true },
});

// ---------------------------------------------------------------- load commands
const commands = new Map();
const componentHandlers = []; // [prefix, handler]
const commandDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandDir).filter((f) => f.endsWith('.js'))) {
  const mod = require(path.join(commandDir, file));
  for (const cmd of [].concat(mod.commands || mod)) {
    if (cmd.data && cmd.execute) commands.set(cmd.data.name, cmd);
  }
  for (const [prefix, fn] of Object.entries(mod.components || {})) componentHandlers.push([prefix, fn]);
  if (mod.init) mod.init(client);
}
client.commands = commands;

// Feature modules (event listeners, schedulers, component handlers)
const features = ['welcome', 'logs', 'levels', 'banter', 'admin-ai', 'stats', 'tempvc', 'starboard', 'chatgames', 'scheduler', 'reactionroles', 'guard'];
for (const name of features) {
  const mod = require(`./features/${name}`);
  if (mod.init) mod.init(client);
  for (const [prefix, fn] of Object.entries(mod.components || {})) componentHandlers.push([prefix, fn]);
}

// ---------------------------------------------------------------- register slash commands
async function registerCommands(guild) {
  const body = [...commands.values()].map((c) => c.data.toJSON());
  try {
    await guild.commands.set(body);
  } catch (err) {
    console.error(`[commands] could not register in ${guild.name}:`, err.message);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag} — in ${c.guilds.cache.size} server(s)`);
  c.user.setActivity('the server | /help', { type: ActivityType.Watching });
  // Guild-scoped registration shows up instantly (global takes up to an hour).
  for (const guild of c.guilds.cache.values()) await registerCommands(guild);
  console.log(`✅ Registered ${commands.size} slash commands`);
});

client.on(Events.GuildCreate, (guild) => registerCommands(guild));

// ---------------------------------------------------------------- interaction router
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction);
      return;
    }
    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction);
      return;
    }
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const id = interaction.customId;
      const match = componentHandlers.find(([prefix]) => id === prefix || id.startsWith(prefix + ':'));
      if (match) await match[1](interaction);
    }
  } catch (err) {
    console.error('[interaction]', err);
    const payload = { content: '💥 Something went wrong doing that. Try again?', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else if (interaction.isRepliable()) await interaction.reply(payload);
    } catch {
      /* ignore */
    }
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

client.login(config.token).catch((err) => {
  if (/disallowed intents/i.test(err.message)) {
    console.error(
      '\n❌ Discord refused the connection: privileged intents are off.\n' +
        '   Go to https://discord.com/developers/applications → your app → Bot,\n' +
        '   and turn ON "Server Members Intent" and "Message Content Intent".\n',
    );
  } else {
    console.error('❌ Login failed:', err.message);
  }
  process.exit(1);
});
