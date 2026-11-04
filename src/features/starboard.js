// Hall of fame: messages with 5+ ⭐ get pinned forever.
const { Events } = require('discord.js');
const store = require('../store');
const { channel, embed } = require('../util/helpers');

const THRESHOLD = 5;

function init(client) {
  client.on(Events.MessageReactionAdd, async (reaction) => {
    try {
      if (reaction.partial) await reaction.fetch();
      if (reaction.emoji.name !== '⭐') return;
      const msg = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
      if (!msg.guild || msg.author.bot) return;
      const hof = channel(msg.guild, 'hall_of_fame');
      if (!hof || msg.channel.id === hof.id) return;
      const g = store.guild(msg.guild.id);
      if (reaction.count < THRESHOLD || g.starboard[msg.id]) return;

      const e = embed(0xf1c40f)
        .setAuthor({ name: msg.member?.displayName || msg.author.username, iconURL: msg.author.displayAvatarURL() })
        .setDescription(`${msg.content?.slice(0, 3800) || ''}\n\n[Jump to message](${msg.url})`)
        .setFooter({ text: `⭐ ${reaction.count} in #${msg.channel.name}` })
        .setTimestamp(msg.createdAt);
      const img = msg.attachments.find((a) => a.contentType?.startsWith('image/'));
      if (img) e.setImage(img.url);
      const posted = await hof.send({ embeds: [e] });
      g.starboard[msg.id] = posted.id;
      store.markDirty();
      require('./levels').addXp(msg.member, 40, null).catch(() => {});
    } catch {
      /* ignore */
    }
  });
}

module.exports = { init };
