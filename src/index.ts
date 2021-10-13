// Imports
import Discord, { Formatters } from 'discord.js';
import { REST as DiscordREST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import mongoose from 'mongoose';
import express from 'express';
import axios, { AxiosResponse } from 'axios';
import queue from 'queue';
import * as util from 'util';
import { Version2Client, Config as JiraConfig } from 'jira.js';
import { components as JiraComponents } from './types/jira';

// Config
const config = require('../config.json');

// Variables
export const clipQueue = queue({ autostart: true, concurrency: 1, timeout: undefined });

// Pre-init
// TODO: Add Sentry and Loki
// Mongoose
export const conn1 = mongoose.createConnection(`mongodb+srv://${config.mongodb.username}:${config.mongodb.password}@${config.mongodb.host}/${config.mongodb.database}`, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
	useFindAndModify: false,
});

export const conn2 = mongoose.createConnection(`mongodb+srv://${config.mongoDbOauth.username}:${config.mongoDbOauth.password}@${config.mongoDbOauth.host}/${config.mongoDbOauth.database}`, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
	useFindAndModify: false,
});

// Init
/* eslint-disable */
import * as jira from './jira';
/* eslint-enable */

// Discord
export const client = new Discord.Client({
	partials: ['GUILD_MEMBER', 'MESSAGE', 'REACTION'],
	intents: ['GUILDS', 'GUILD_INTEGRATIONS', 'GUILD_MESSAGES', 'GUILD_MESSAGE_REACTIONS'],
});
const rest = new DiscordREST({ version: '9' }).setToken(config.discord.authToken);

// Jira
const jiraClient = new Version2Client({
	host: config.jira.url,
	credentials: {
		username: config.jira.username,
		password: config.jira.password,
	},
} as JiraConfig);

// Express
const app = express();
app.listen(config.port);

app.use(express.json());
app.use(jira.router);

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
	if (!interaction.isCommand()) return;

	if (interaction.commandName === 'project') {
		await interaction.deferReply();

		const key = interaction.options.getString('id', true);

		const issue = await jiraClient.issues.getIssue({ issueIdOrKey: key })
			.catch(async (err) => {
				console.error(err);
				await interaction.editReply('Something went wrong, please try again later.');
			});

		const { data } = await axios.get(`${config.jira.url}/rest/api/2/issue/${key}`, {
			auth: {
				username: config.jira.username,
				password: config.jira.password,
			},
		}).catch(async (err) => {
			console.error(err);
			await interaction.editReply('Something went wrong, please try again later.');
		}) as AxiosResponse<JiraComponents['schemas']['IssueBean']>;

		let languages = '';

		let user = 'None';
		if (issue!.fields!.assignee) {
			type UserLink = {
				_id: string;
			};

			const { data: userData } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
				params: { key: data.fields!.assignee.key },
				auth: {
					username: config.oauthServer.clientId,
					password: config.oauthServer.clientSecret,
				},
			}).catch(async (err) => {
				console.log(err.response.data);
				await interaction.editReply('Something went wrong, please try again later.');
				throw new Error(err);
			}) as AxiosResponse<UserLink>;
			user = `<@${userData._id}`;
		}

		// eslint-disable-next-line no-return-assign
		issue!.fields![config.jira.fields.langs].map((language: JiraComponents['schemas']['CustomFieldOption']) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

		let timestamps = issue!.fields![config.jira.fields.timestamps];
		if (issue!.fields![config.jira.fields.timestamps].split(',').length > 3) {
			timestamps = '';
			const split = issue!.fields![config.jira.fields.timestamps].split(',');
			// eslint-disable-next-line no-plusplus
			for (let i = 0; i < 3; i++) {
				if (i !== 0)timestamps += ',';
				timestamps += split[i];
			}
			timestamps += '...';
		}

		const embed = new Discord.MessageEmbed()
			.setTitle(` ${issue!.key}`)
			.setColor('#0052cc')
			.setDescription(issue!.fields!.summary || 'None')
			.addField('Status', issue!.fields!.status.name!, true)
			.addField('Assignee', user, true)
			.addField('Source', `[link](${issue!.fields![config.jira.fields.videoLink]})`)
			.addField('Timestamp(s)', timestamps)
			.setURL(`${config.jira.url}/projects/${issue!.fields!.project.key}/issues/${issue!.key}`)
			.setFooter(`Due date: ${issue!.fields!.duedate || 'unknown'}`);

		await interaction.editReply({ embeds: [embed] });
	}
});

// client.on('messageReactionAdd', jira.messageReactionAddHandler);

client.login(config.discord.authToken);
