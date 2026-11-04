// Join "➕ Create VC" → get your own voice channel. It disappears when empty.
const { Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const store = require('../store');
const { pick } = require('../util/helpers');

const NAMES = ['{name}\'s Lobby', '{name}\'s Squad', '{name}\'s Den', '{name}\'s Clutch Room', '{name}\'s Battlestation', '{name}\'s Hideout'];

function init(client) {
  client.on(Events.VoiceStateUpdate, async (before, after) => {
    const guild = after.guild || before.guild;
    const g = store.guild(guild.id);
    const createId = g.channels.create_vc;

    // Joined the creator channel
    if (createId && after.channelId === createId && after.member) {
      const creator = guild.channels.cache.get(createId);
      const name = pick(NAMES).replace('{name}', after.member.displayName).slice(0, 90);
      try {
        const ch = await guild.channels.create({
          name: `🔊 ${name}`,
          type: ChannelType.GuildVoice,
          parent: creator?.parentId,
          permissionOverwrites: [
            ...(creator?.permissionOverwrites.cache.map((o) => ({ id: o.id, allow: o.allow, deny: o.deny })) || []),
            { id: after.member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.Connect] },
          ],
        });
        g.tempVcs[ch.id] = after.member.id;
        store.markDirty();
        await after.member.voice.setChannel(ch).catch(() => {});
        await ch
          .send(`👋 <@${after.member.id}>, this is your room. Rename it, set a user limit or lock it from the channel settings ⚙️. It vanishes when everyone leaves.`)
          .catch(() => {});
      } catch (err) {
        console.error('[tempvc]', err.message);
      }
    }

    // Left a temp channel → delete if empty
    if (before.channelId && g.tempVcs[before.channelId]) {
      const ch = guild.channels.cache.get(before.channelId);
      if (!ch) {
        delete g.tempVcs[before.channelId];
        store.markDirty();
      } else if (ch.members.size === 0) {
        await ch.delete('Temp VC empty').catch(() => {});
        delete g.tempVcs[before.channelId];
        store.markDirty();
      }
    }
  });

  // Clean up leftovers after a restart
  client.once(Events.ClientReady, () => {
    for (const guild of client.guilds.cache.values()) {
      const g = store.guild(guild.id);
      for (const id of Object.keys(g.tempVcs)) {
        const ch = guild.channels.cache.get(id);
        if (!ch) delete g.tempVcs[id];
        else if (ch.members.size === 0) ch.delete('Temp VC empty').then(() => delete g.tempVcs[id]).catch(() => {});
      }
      store.markDirty();
    }
  });
}

module.exports = { init };
