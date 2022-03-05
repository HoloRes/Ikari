// Imports
import Discord, { Formatters } from 'discord.js';
import { REST as DiscordREST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import mongoose from 'mongoose';
import express from 'express';
import * as util from 'util';
import { Version2Client } from 'jira.js';
import helmet from 'helmet';
import winston from 'winston';
import LokiTransport from 'winston-loki';
import * as Sentry from '@sentry/node';
import SlackTransport from 'winston-slack-webhook-transport';
import { RewriteFrames } from '@sentry/integrations';
import rootDir from './root';

// Config
// eslint-disable-next-line import/order
const config = require('../config.json');

// Pre-init
// Sentry
if (config.sentryDsn) {
	Sentry.init({
		dsn: config.sentryDsn,
		release: process.env.COMMIT_SHA ? `ikari@${process.env.COMMIT_SHA}` : undefined,
		environment: process.env.ENVIRONMENT ?? 'development',
		integrations: [
			new RewriteFrames({
				root: rootDir,
			}),
		],
	});
}

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
/* eslint-disable import/first */
import * as jira from './lib/jira';
import commandInteractionHandler from './interactions/command';
import updateRoles from './lib/updateRoles';
import buttonInteractionHandler from './interactions/button';
import userContextMenuInteractionHandler from './interactions/context';
import './lib/timer';
/* eslint-enable */

// Logger
const myFormat = winston.format.printf(({
	level, message, label, timestamp,
}) => `${timestamp} ${label ? `[${label}]` : ''} ${level}: ${message}`);

export const logger = winston.createLogger({
	transports: [
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.splat(),
				winston.format.timestamp(),
				winston.format.cli(),
				myFormat,
			),
			level: config.logTransports?.console?.level ?? 'info',
		}),
	],
});

if (config.logTransports?.loki) {
	logger.add(new LokiTransport({
		host: config.logTransports.loki.host,
		level: config.logTransports.loki.level ?? 'info',
		labels: { service: 'ikari' },
	}));
	logger.debug('Added Loki transport');
}
if (config.logTransports?.discord) {
	logger.add(new SlackTransport({
		webhookUrl: config.logTransports.discord.url,
		level: config.logTransports.discord.level ?? 'info',
	}));
}

// Discord
export const client = new Discord.Client({
	partials: ['GUILD_MEMBER', 'MESSAGE', 'REACTION'],
	intents: ['GUILDS', 'GUILD_INTEGRATIONS', 'GUILD_MESSAGES', 'GUILD_MEMBERS', 'GUILD_MESSAGE_REACTIONS'],
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
	logger.info(`Bot started, running: ${process.env.COMMIT_SHA ?? 'unknown'}`);

	// Show commit SHA in playing status when not in production
	if (process.env.ENVIRONMENT !== 'production') {
		client.user!.setPresence({
			activities: [{
				name: `version: ${process.env.COMMIT_SHA?.substring(0, 7) ?? 'unknown'}`,
				type: 'PLAYING',
			}],
		});
	}
});

// Command handler
client.on('messageCreate', (message) => {
	if (message.author.bot || !message.content.startsWith(config.discord.prefix)) return;
	const cmd = message.content.slice(config.discord.prefix.length)
		.split(' ');
	const args = cmd.slice(1);
	// Debug commands
	switch (cmd[0]) {
		case 'eval': {
			// Hardcode to only allow GoldElysium
			if (message.author.id !== '515984841716793344') return;

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
		case 'settingSlashCommandSetup': {
			// Hardcode to only allow GoldElysium
			if (message.author.id !== '515984841716793344') return;
			(async () => {
				try {
					await rest.put(
						Routes.applicationGuildCommands(client.application!.id, message.guild!.id),
						{
							body: [
								{
									name: 'setting',
									description: 'Set/get setting',
									defaultPermission: false,
									options: [
										{
											type: 3,
											name: 'name',
											description: 'The setting name',
											default: false,
											required: true,
										},
										{
											type: 3,
											name: 'value',
											description: 'New value',
											default: false,
											required: false,
										},
									],
								},
							],
						},
					);
					await message.reply('Done!');
				} catch (e) {
					logger.error(e);
				}
			})();
			break;
		}
		default: {
			break;
		}
	}
});

client.on('interactionCreate', (interaction) => {
	if (interaction.isCommand()) commandInteractionHandler(interaction);
	if (interaction.isButton()) buttonInteractionHandler(interaction);
	if (interaction.isUserContextMenu()) userContextMenuInteractionHandler(interaction);
});

client.on('guildMemberUpdate', (_, member) => {
	// Call function to update the user's document in the db with all their roles.
	updateRoles(member);
});

client.login(config.discord.authToken);
