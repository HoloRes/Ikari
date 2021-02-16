// Modules
const Discord = require('discord.js');

// Local Files
const config = require('./config/config.json');
const clipper = require('./tools/clipper.js');

// Variables

const client = new Discord.Client({
	partials: ['GUILD_MEMBER', 'MESSAGE', 'REACTION'],
});
exports.client = client;

client.on('ready', () => {
	// eslint-disable-next-line no-console
	console.log('ready');
});

client.on('message', (message) => {
	if (message.author.bot || !message.content.startsWith(config.discord.prefix)) return;
	const cmd = message.content.slice(config.discord.prefix.length).split(' ');
	const args = cmd.slice(1);
	// Temporarily keeping all commands here
	// Gonna level with you, most of this is held together with duct tape and prayers atm
	switch (cmd[0]) {
	case 'clip': {
		if (args[0] === 'help' && args[1] === null) {
			message.channel.send('Usage:\nTODO: add usage guide');
			break;
		}
		if (args[4] === 'mkv' || args[4] === 'mp4') {
			clipper.clipVideo(args[0], args[1], args[2], args[3], args[4], message);
		} else {
			message.channel.send('Missing Arguments');
		}
		break;
	}
	case 'help': {
		message.channel.send('Currently Functional Commands:\n```clip - Type "i!clip help" for usage```');
		break;
	}
	default: {
		break;
	}
	}
});

client.login(config.discord.token);
