// Imports
import Discord from 'discord.js';
import mongoose from 'mongoose';
import express from 'express';
import axios from 'axios';
import queue from 'queue';

// Init
import * as jira from './jira';

// Config
const config = require('../config.json');

// Variables
export const clipQueue = queue({ autostart: true, concurrency: 1, timeout: null });

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

// Discord
export const client = new Discord.Client({
	partials: ['GUILD_MEMBER', 'MESSAGE', 'REACTION'],
	intents: ['GUILDS', 'GUILD_INTEGRATIONS', 'GUILD_MESSAGES', 'GUILD_MESSAGE_REACTIONS'],
});

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
	// Temporarily keeping all commands here
	switch (cmd[0]) {
		case 'queueState': {
			message.channel.send(clipQueue.length);
			break;
		}
		case 'slashCommandSetup': {
			if (message.author.id !== '515984841716793344') return;
			client.api.applications(client.user.id).guilds(message.guild.id).commands.post({
				data: {
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
			});
			message.reply('Done!');
			break;
		}
		default: {
			console.log(args);
			break;
		}
	}
});

// eslint-disable-next-line consistent-return
client.ws.on('INTERACTION_CREATE', async (interaction) => {
	if (interaction.type === 1) {
		return client.api.interactions(interaction.id, interaction.token)
			.callback
			.post({ data: { type: 1 } });
	}
	// eslint-disable-next-line consistent-return
	if (interaction.type !== 2) return;

	if (interaction.data.name === 'project') {
		client.api.interactions(interaction.id, interaction.token).callback.post({
			data: {
				type: 5,
			},
		});
		const key = interaction.data.options[0].value.toUpperCase();
		const { data } = await axios.get(`${config.jira.url}/rest/api/2/issue/${key}`, {
			auth: {
				username: config.jira.username,
				password: config.jira.password,
			},
		}).catch((err) => {
			if (err.response && err.response.status === 404) return new Discord.WebhookClient(client.user.id, interaction.token).editMessage('@original', 'Project not found');
			return new Discord.WebhookClient(client.user.id, interaction.token).editMessage('@original', 'Something went wrong, please try again');
		});

		let languages = '';

		let user = 'None';
		if (data.fields.assignee) {
			const { userData } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
				params: { key: data.fields.assignee.key },
				auth: {
					username: config.oauthServer.clientId,
					password: config.oauthServer.clientSecret,
				},
			})
				.catch((err) => {
					console.log(err.response.data);
					new Discord.WebhookClient(client.user.id, interaction.token).editMessage('@original', 'Something went wrong, please try again');
					throw new Error(err);
				});
			user = `<@${userData._id}`;
		}

		// eslint-disable-next-line no-return-assign
		data.fields[config.jira.fields.langs].map((language) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

		let timestamps = data.fields[config.jira.fields.timestamps];
		if (data.fields[config.jira.fields.timestamps].split(',').length > 3) {
			timestamps = '';
			const split = data.fields[config.jira.fields.timestamps].split(',');
			// eslint-disable-next-line no-plusplus
			for (let i = 0; i < 3; i++) {
				if (i !== 0)timestamps += ',';
				timestamps += split[i];
			}
			timestamps += '...';
		}

		const embed = new Discord.MessageEmbed()
			.setTitle(` ${data.key}`)
			.setColor('#0052cc')
			.setDescription(data.fields.summary || 'None')
			.addField('Status', data.fields.status.name, true)
			.addField('Assignee', user, true)
			.addField('Source', `[link](${data.fields[config.jira.fields.videoLink]})`)
			.addField('Timestamp(s)', timestamps)
			.setURL(`${config.jira.url}/projects/${data.fields.project.key}/issues/${data.key}`)
			.setFooter(`Due date: ${data.fields.duedate || 'unknown'}`);

		return new Discord.WebhookClient(client.user.id, interaction.token).editMessage('@original', embed);
	}
});

client.on('messageReactionAdd', jira.messageReactionAddHandler);

client.login(config.discord.authToken);
