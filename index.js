// Imports
const Discord = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');

// Config
const config = require('./config.json');

// Variables

// Pre-init
// TODO: Add Sentry and Loki
// Mongoose
exports.conn1 = mongoose.createConnection(`mongodb+srv://${config.mongodb.username}:${config.mongodb.password}@${config.mongodb.host}/${config.mongodb.database}`, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
	useFindAndModify: false,
});

exports.conn2 = mongoose.createConnection(`mongodb+srv://${config.mongoDbOauth.username}:${config.mongoDbOauth.password}@${config.mongoDbOauth.host}/${config.mongoDbOauth.database}`, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
	useFindAndModify: false,
});

// Discord
const client = new Discord.Client({
	partials: ['GUILD_MEMBER', 'MESSAGE', 'REACTION'],
});
exports.client = client;

// Express
const app = express();
app.listen();

// Init
const jira = require('./jira');

app.use(express.json());
app.use(jira.router);

client.on('ready', () => {
	console.log('READY');
});

// Command handler
client.on('message', (message) => {
	if (message.author.bot || !message.content.startsWith(config.discord.prefix)) return;
	const cmd = message.content.slice(config.discord.prefix.length)
		.split(' ');
	const args = cmd.slice(1);
	// Temporarily keeping all commands here
	switch (cmd[0]) {
	default: {
		console.log(args);
		break;
	}
	}
});

client.on('messageReactionAdd', jira.messageReactionAddHandler);

client.login(config.discord.token);
