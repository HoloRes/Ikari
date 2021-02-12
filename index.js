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
	console.log('ready');
});

client.on('message', (message) => {
	if (message.author.bot || !message.content.startsWith(config.discord.prefix)) return;
	const cmd = message.content.slice(config.discord.prefix.length).split(' ');
	const args = cmd.slice(1);
	// Temporarily keeping all commands here
	switch (cmd[0]) {
	case 'clip': {
		clipper.clipVideo('https://www.youtube.com/watch?v=88UYLWDjomE', 'A', '[0:00-0:10]', 'mkv');
		break;
	}
	default: {
		break;
	}
	}
});

client.login(config.discord.token);
