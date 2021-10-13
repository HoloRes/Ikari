/* eslint-disable no-console */
// Imports
import { Router, Request } from 'express';
import {
	BaseGuildTextChannel, MessageActionRow, MessageButton, MessageEmbed,
} from 'discord.js';
import axios from 'axios';

// Models
import IdLink from './models/IdLink';
import Setting from './models/Setting';
import { client, clipQueue } from './index';
import clipRequest from './tools/clipper';
import { components } from './types/jira';
import RoleLink from './models/RoleLink';
import StatusLink from './models/StatusLink';

// Local files
const config = require('../config.json');

// Variables
const url = `${config.jira.url}/rest/api/latest`;

// Init
// eslint-disable-next-line import/prefer-default-export
export const router = Router();

type JiraField = {
	value: string;
};

interface WebhookBody {
	timestamp: string;
	webhookEvent: string;
	user: components['schemas']['UserBean'];
	issue: components['schemas']['IssueBean'];
	changelog: components['schemas']['Changelog'];
	comment: components['schemas']['Comment'];
	transition: components['schemas']['Transition'] & { transitionName: string };
}

// Routes
router.post('/webhook', async (req: Request<{}, {}, WebhookBody>, res) => {
	if (req.query.token !== config.webhookSecret) {
		res.status(403).end();
		return;
	}
	res.status(200).end();

	const projectsChannelSetting = await Setting.findById('projectsChannel').lean().exec()
		.catch((err) => {
			throw new Error(err);
		});

	if (!projectsChannelSetting) return;

	const projectsChannel = await client.channels.fetch(projectsChannelSetting.value)
		.catch((err) => {
			throw new Error(err);
		}) as unknown as BaseGuildTextChannel | null;

	if (projectsChannel?.type !== 'GUILD_TEXT') throw new Error('Channel is not a guild text channel');

	if (req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') {
		const channelLink = await RoleLink.findById('translator').lean().exec()
			.catch((err) => {
				throw new Error(err);
			});

		// eslint-disable-next-line consistent-return
		if (!channelLink) return console.warn('No channel link for translator found!');

		const channel = await client.channels.fetch(channelLink.discordChannelId)
			.catch((err) => {
				throw new Error(err);
			}) as unknown as BaseGuildTextChannel | null;

		if (channel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${channelLink.discordChannelId} is not a guild text channel`);

		const link = new IdLink({
			jiraId: req.body.issue.id,
			type: 'translation',
		});

		let languages = '';

		// eslint-disable-next-line no-return-assign
		req.body.issue.fields![config.jira.fields.langs].map((language: JiraField) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

		const embed = new MessageEmbed()
			.setTitle(`${req.body.issue.key}`)
			.setColor('#0052cc')
			.setDescription(req.body.issue.fields!.summary || 'None')
			.addField('Status', req.body.issue.fields!.status.name, true)
			.addField('Assignee', 'Unassigned', true)
			.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
			.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
			.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

		const row = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setCustomId(`assignToMe-${req.body.issue.key}`)
					.setLabel('Assign to me')
					.setStyle('SUCCESS')
					.setEmoji('819518919739965490'),
			);

		const msg = await projectsChannel.send({ embeds: [embed], components: [row] })
			.catch((err) => {
				throw new Error(err);
			});
		link.discordMessageId = msg.id;
		link.save((err) => {
			if (err) throw err;
		});
	} else {
		const link = await IdLink.findOne({ jiraId: req.body.issue.id })
			.exec()
			.catch((err) => {
				throw err;
			});
		if (!link || link.finished) return;

		const statusLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
			.catch((err) => {
				throw err;
			});

		// eslint-disable-next-line consistent-return
		if (!statusLink) return console.warn(`No link found for: ${req.body.issue.fields!.status.name}`);

		const channelLink = await RoleLink.findById(statusLink.role).lean().exec()
			.catch((err) => {
				throw err;
			});

		// eslint-disable-next-line consistent-return
		if (!channelLink) return console.warn(`No channel link found for: ${req.body.issue.fields!.status.name}`);

		const channel = await client.channels.fetch(channelLink.discordChannelId)
			.catch((err) => {
				throw new Error(err);
			}) as unknown as BaseGuildTextChannel | null;

		if (channel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${channelLink.discordChannelId} is not a guild text channel`);

		const msg = await channel.messages.fetch(link.discordMessageId!)
			.catch((err) => {
				throw new Error(err);
			});

		if (req.body.transition && req.body.transition.transitionName === 'Assign') {
			if (req.body.issue.fields!.assignee === null) {
				const row = new MessageActionRow()
					.addComponents(
						new MessageButton()
							.setCustomId(`assignToMe-${req.body.issue.key}`)
							.setLabel('Assign to me')
							.setStyle('SUCCESS')
							.setEmoji('819518919739965490'),
					);

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: 'Unassigned',
				});
				msg.edit({ embeds: [embed], components: [row] });

				const status = req.body.issue.fields!.status.name;
				if (status === 'Open' || status === 'Rejected' || status === 'Being clipped' || status === 'Uploaded') return;

				msg.react('819518919739965490');
			} else {
				const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields!.assignee.key },
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
					value: `<@${user._id}>`,
				});
				msg.edit({ embeds: [embed] });
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						fetchedUser.send({ content: 'New assignment', embeds: [embed] });
					}).catch(console.error);
			}
		} else if (req.body.transition && req.body.transition.transitionName === 'Finish') {
			msg.delete();
			link.finished = true;
			link.save((err) => {
				if (err) throw err;
			});
		} else if (req.body.transition && req.body.transition.transitionName === 'Send to Ikari') {
			const videoRegex = /^(http(s)?:\/\/)?(www\.)?youtu((\.be\/)|(be\.com\/watch\?v=))[0-z_-]{11}$/g;
			const videoType = videoRegex.test(req.body.issue.fields![config.jira.fields.videoLink]) ? 'youtube' : 'other';
			console.log('REQ RECEIVED');
			clipQueue.push((cb) => {
				clipRequest([
					videoType,
					req.body.issue.fields![config.jira.fields.videoLink],
					req.body.issue.fields![config.jira.fields.timestamps],
					req.body.issue.fields!.summary,
					req.body.issue.fields![config.jira.fields.fileExt].value.toLowerCase(),
					req.body.issue.fields![config.jira.fields.extraArgs],
				])
					.then(() => {
						axios.post(`${url}/issue/${link.jiraId}/transitions`, {
							transition: {
								id: '41',
							},
						}, {
							auth: {
								username: config.jira.username,
								password: config.jira.password,
							},
						})
							.catch((err) => {
								console.log(err);
								throw new Error(err);
							});
						cb!();
					}, () => {
						axios.post(`${url}/issue/${link.jiraId}/transitions`, {
							transition: {
								id: '121',
							},
						}, {
							auth: {
								username: config.jira.username,
								password: config.jira.password,
							},
						})
							.catch((err) => {
								console.log(err);
								clipQueue.shift();
								clipQueue.start();
								throw new Error(err);
							});
						cb!();
					})
					.catch((err) => {
						console.log(err.response.data);
						throw new Error(err);
					});
			});
		} else {
			// TODO: Figure out the new channel, delete old message, and create new one.
			let languages = '';

			// eslint-disable-next-line no-return-assign
			req.body.issue.fields![config.jira.fields.langs].map((language: JiraField) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

			const embed = new MessageEmbed()
				.setTitle(`${req.body.issue.key}`)
				.setColor('#0052cc')
				.setDescription(req.body.issue.fields!.summary || 'None')
				.addField('Status', req.body.issue.fields!.status.name, true)
				.addField('Assignee', msg.embeds[0].fields[1].value, true)
				.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
				.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
				.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

			msg.edit({ embeds: [embed] });
		}
	}
});
