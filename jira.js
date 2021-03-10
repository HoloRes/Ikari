// Imports
const { Router } = require('express');
const { MessageEmbed } = require('discord.js');
const axios = require('axios');

// Models
const IdLink = require('./models/IdLink');
const Setting = require('./models/Setting');

// Local files
const config = require('./config.json');
const { client } = require('./index');

// Variables
const url = `${config.jira.url}/rest/api/latest`;

// Init
const router = Router();
exports.router = router;

// Routes
router.post('/webhook', async (req, res) => {
	res.status(200).end();
	if (req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') {
		const projectsChannelSetting = await Setting.findById('projectsChannel').lean().exec()
			.catch((err) => {
				throw new Error(err);
			});
		if (!projectsChannelSetting) return;
		const link = new IdLink({
			jiraId: req.body.issue.id,
		});
		const projectsChannel = await client.channels.fetch(projectsChannelSetting.value)
			.catch((err) => {
				throw new Error(err);
			});

		const embed = new MessageEmbed()
			.setTitle(`Project - ${req.body.issue.key}`)
			.setColor('#0052cc')
			.setDescription(req.body.issue.summary)
			.addField('Status', 'Open')
			.addField('Assignee', 'Unassigned')
			.addField('Priority', 'Highest')
			.addField('Languages', 'JP')
			.setURL(`${config.jira.url}/projects/${req.body.project.key}/issues/${req.body.issue.key}`);

		const msg = await projectsChannel.send(embed)
			.catch((err) => {
				throw new Error(err);
			});
		link.discordMessageId = msg.id;
		link.save((err) => {
			throw new Error(err);
		});
	} else {
		const link = await IdLink.findOne({ jiraId: req.body.issue.id })
			.lean()
			.exec()
			.catch((err) => {
				throw new Error(err);
			});
		if (!link) return;

		const user = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
			params: { key: req.body.user.key },
			auth: {
				username: config.oauthServer.clientId,
				password: config.oauthServer.clientSecret,
			},
		}).catch((err) => {
			console.log(err.response.data);
			throw new Error(err);
		});
	}
});

// Event handlers
exports.messageReactionAddHandler = async (message, reactionUser) => {
	const link = await IdLink.findById(message.id).lean().exec()
		.catch((err) => { throw new Error(err); });
	if (!link) return;

	const user = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
		params: { key: reactionUser.id },
		auth: {
			username: config.oauthServer.clientId,
			password: config.oauthServer.clientSecret,
		},
	}).catch((err) => {
		console.log(err.response.data);
		throw new Error(err);
	});

	if (!user) reactionUser.send('Could not find your Jira account, please sign in once to link your account.');
	else {
		axios.put(`${url}/issue/${link.jiraId}/assignee`, {
			name: user.username,
		}).catch((err) => {
			console.log(err.response.data);
			throw new Error(err);
		});
	}
};
