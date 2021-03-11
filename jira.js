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

	const projectsChannelSetting = await Setting.findById('projectsChannel').lean().exec()
		.catch((err) => {
			throw new Error(err);
		});

	const projectsChannel = await client.channels.fetch(projectsChannelSetting.value)
		.catch((err) => {
			throw new Error(err);
		});

	if (!projectsChannelSetting) return;

	if (req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') {
		const link = new IdLink({
			jiraId: req.body.issue.id,
		});

		let languages = '';

		// TODO: Replace language field id for prod
		// eslint-disable-next-line no-return-assign
		req.body.issue.fields.customfield_10202.map((language) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

		const embed = new MessageEmbed()
			.setTitle(`Project - ${req.body.issue.key}`)
			.setColor('#0052cc')
			.setDescription(req.body.issue.fields.summary || 'None')
			.addField('Status', req.body.issue.fields.status.name)
			.addField('Assignee', 'Unassigned')
			.addField('Priority', req.body.issue.fields.priority.name)
			.addField('Languages', languages)
			.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

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

		const msg = await projectsChannel.messages.fetch(link.discordMessageId)
			.catch((err) => {
				throw new Error(err);
			});

		if (req.body.transition && req.body.transition.transitionName === 'Assign') {
			if (req.body.issue.fields.assignee === null) {
				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: 'Unassigned',
				});
				msg.edit(embed);

				// TODO: Check workflow status and add reaction if needed
				const status = req.body.issue.fields.status.name;
				if (status === 'Open' || status === 'Rejected' || status === 'Being clipped' || status === 'Uploaded') return;

				msg.react('819518919739965490');
			} else {
				const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields.assignee.key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				})
					.catch((err) => {
						console.log(err.response.data);
						throw new Error(err);
					});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: `<@${user._id}>`,
				});
				msg.edit(embed);
			}
		} else {
			let languages = '';

			// TODO: Replace language field id for prod
			// eslint-disable-next-line no-return-assign
			req.body.issue.fields.customfield_10202.map((language) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

			const embed = new MessageEmbed()
				.setTitle(`Project - ${req.body.issue.key}`)
				.setColor('#0052cc')
				.setDescription(req.body.issue.fields.summary || 'None')
				.addField('Status', req.body.issue.fields.status.name)
				.addField('Assignee', msg.embeds[0].fields[1].value)
				.addField('Priority', req.body.issue.fields.priority.name)
				.addField('Languages', languages)
				.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

			msg.edit(embed);
		}
	}
});

// Event handlers
exports.messageReactionAddHandler = async (messageReaction, reactionUser) => {
	if (reactionUser.bot || messageReaction.emoji.id !== '819518919739965490') return;
	const link = await IdLink.findOne({ discordMessageId: messageReaction.message.id }).lean().exec()
		.catch((err) => { throw new Error(err); });
	if (!link) return;

	// TODO: Role validation

	const projectsChannelSetting = await Setting.findById('projectsChannel').lean().exec()
		.catch((err) => {
			throw new Error(err);
		});

	const projectsChannel = await client.channels.fetch(projectsChannelSetting.value)
		.catch((err) => {
			throw new Error(err);
		});

	if (!projectsChannelSetting) return;

	const msg = await projectsChannel.messages.fetch(link.discordMessageId)
		.catch((err) => {
			throw new Error(err);
		});

	const languages = msg.embeds[0].fields[3].value.split(', ');
	switch (msg.embeds[0].fields[0].value) {
	case 'Translating':
		const inGroups = [];
		break;
	case 'Translation Check':
		const inGroups2 = [];
		break;
	case 'Proofreading':
		return issue.get('assignee')?.isInGroup('Proofreader');
		break;
	case 'Subbing':
		return issue.get('assignee')?.isInGroup('Subtitler');
		break;
	case 'PreQC':
		return issue.get('assignee')?.isInGroup('Pre-Quality Control');
		break;
	case 'Video Editing':
		return issue.get('assignee')?.isInGroup('Video Editor');
		break;
	case 'Quality Control':
		return issue.get('assignee')?.isInGroup('Quality Control');
		break;
	default:
		return false;
		break;
	}
	const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
		params: { id: reactionUser.id },
		auth: {
			username: config.oauthServer.clientId,
			password: config.oauthServer.clientSecret,
		},
	}).catch((err) => {
		console.log(err.response.data);
		throw new Error(err);
	});

	const embed = msg.embeds[0].spliceFields(1, 1, {
		name: 'Assignee',
		value: `<@${reactionUser.id}>`,
	});

	if (!user) reactionUser.send('Could not find your Jira account, please sign in once to link your account.');
	else {
		axios.put(`${url}/issue/${link.jiraId}/assignee`, {
			name: user.username,
		}, {
			auth: {
				username: config.jira.username,
				password: config.jira.password,
			},
		}).then(() => {
			msg.edit(embed);
			msg.reactions.removeAll();
		}).catch((err) => {
			console.log(err.response.data);
			throw new Error(err);
		});
	}
};
