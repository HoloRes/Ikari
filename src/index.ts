// Imports
import Discord, { Formatters } from 'discord.js';
import { REST as DiscordREST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import mongoose from 'mongoose';
import express from 'express';
import queue from 'queue';
import * as util from 'util';
import { Version2Client } from 'jira.js';
import helmet from 'helmet';

// Config
// eslint-disable-next-line import/order
const config = require('../config.json');

// Variables
export const clipQueue = queue({ autostart: true, concurrency: 1, timeout: undefined });

// Pre-init
// TODO: Add Sentry and Loki
// Mongoose
export const conn1 = mongoose.createConnection(`mongodb+srv://${config.mongodb.username}:${config.mongodb.password}@${config.mongodb.host}/${config.mongodb.database}`);

export const conn2 = mongoose.createConnection(`mongodb+srv://${config.mongoDbOauth.username}:${config.mongoDbOauth.password}@${config.mongoDbOauth.host}/${config.mongoDbOauth.database}`);

// Jira
export const jiraClient = new Version2Client({
	host: config.jira.url,
	authentication: {
		basic: {
			username: config.jira.username,
			password: config.jira.password,
		},
	},
});

// Init
/* eslint-disable */
import * as jira from './jira';
import commandInteractionHandler from "./interactions/command";
/* eslint-enable */

// Discord
export const client = new Discord.Client({
	partials: ['GUILD_MEMBER', 'MESSAGE', 'REACTION'],
	intents: ['GUILDS', 'GUILD_INTEGRATIONS', 'GUILD_MESSAGES', 'GUILD_MESSAGE_REACTIONS'],
});
const rest = new DiscordREST({ version: '9' }).setToken(config.discord.authToken);

// Express
const app = express();
app.listen(config.port);

app.use(helmet());
app.use(express.json());
app.use(jira.router);

// Heartbeat route
app.get('/heartbeat', (req, res) => {
	res.status(200).send('OK');
});

// Discord
client.on('ready', () => {
	console.log('READY');
});

// Command handler
client.on('messageCreate', (message) => {
	if (message.author.bot || !message.content.startsWith(config.discord.prefix)) return;
	const cmd = message.content.slice(config.discord.prefix.length)
		.split(' ');
	const args = cmd.slice(1);
	// Debug commands
	switch (cmd[0]) {
		case 'queueState': {
			message.channel.send(clipQueue.length.toString(10));
			break;
		}
		case 'eval': {
			// eslint-disable-next-line no-inner-declarations
			function clean(text: string | any) {
				if (typeof (text) === 'string') return text.replace(/'/g, `\`${String.fromCharCode(8203)}`).replace(/@/g, `@${String.fromCharCode(8203)}`);
				return text;
			}
			try {
				const code = args.join(' ');
				// eslint-disable-next-line no-eval
				let evaled = eval(code);

				if (typeof evaled !== 'string') { evaled = util.inspect(evaled); }

				message.channel.send(Formatters.codeBlock(clean(evaled)));
			} catch (err) {
				message.channel.send(`\`ERROR\` \`\`\`xl\n${clean(err)}\n\`\`\``);
			}
			break;
		}
		case 'slashCommandSetup': {
			if (message.author.id !== '515984841716793344') return;
			(async () => {
				try {
					await rest.put(
						Routes.applicationGuildCommands(client.application!.id, message.guild!.id),
						{
							body: [
								{
									name: 'project',
									description: 'Show project info',
									options: [
										{
											type: 3,
											name: 'id',
											description: 'The project id',
											default: false,
											required: true,
										},
									],
								},
							],
						},
					);
					message.reply('Done!');
				} catch (e) {
					console.error(e);
				}
			})();
			break;
		}
		default: {
			console.log(args);
			break;
		}
	}
});

client.on('interactionCreate', async (interaction) => {
	if (interaction.isCommand()) await commandInteractionHandler(interaction);
});

client.login(config.discord.authToken);
