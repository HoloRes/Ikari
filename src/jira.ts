/* eslint-disable no-console */
// Imports
import { Router, Request } from 'express';
import {
	BaseGuildTextChannel, MessageActionRow, MessageButton, MessageEmbed,
} from 'discord.js';
import axios, { AxiosResponse } from 'axios';

// Models
import IdLink from './models/IdLink';
import { client, clipQueue, jiraClient } from './index';
import clipRequest from './tools/clipper';
import { components } from './types/jira';
import RoleLink from './models/RoleLink';
import StatusLink from './models/StatusLink';

// Local files
const config = require('../config.json');

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
			status: req.body.issue.fields!.status.name,
		});

		let languages = '';

		// eslint-disable-next-line no-return-assign
		req.body.issue.fields![config.jira.fields.langs].map((language: JiraField) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

		const embed = new MessageEmbed()
			.setTitle(`${req.body.issue.key}`)
			.setColor('#0052cc')
			.setDescription(req.body.issue.fields!.summary || 'No description available')
			.addField('Status', req.body.issue.fields!.status.name, true)
			.addField('Assignee', 'Unassigned', true)
			.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
			.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
			.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

		const row = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setCustomId(`assignToMe:${req.body.issue.key}`)
					.setLabel('Assign to me')
					.setStyle('SUCCESS')
					.setEmoji('819518919739965490'),
			);

		const msg = await channel.send({ embeds: [embed], components: [row] })
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

		const statusLink = await StatusLink.findById(link.status).lean().exec()
			.catch((err) => {
				throw err;
			});

		// eslint-disable-next-line consistent-return
		if (!statusLink) return console.warn(`No link found for: ${link.status}`);

		const channelLink = await RoleLink.findById(statusLink.role).lean().exec()
			.catch((err) => {
				throw err;
			});

		// eslint-disable-next-line consistent-return
		if (!channelLink) return console.warn(`No channel link found for: ${link.status}`);

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
							.setCustomId(`assignToMe:${req.body.issue.key}`)
							.setLabel('Assign to me')
							.setStyle('SUCCESS')
							.setEmoji('819518919739965490'),
					);

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: 'Unassigned',
				} as any);
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
				}) as AxiosResponse<any>;

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: `<@${user._id}>`,
				} as any);
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
				]).then(async () => {
					await jiraClient.issues.doTransition({
						issueIdOrKey: link.jiraId!,
						transition: { id: '41' },
					}).catch((err) => {
						console.log(err);
						clipQueue.shift();
						clipQueue.start();
						throw new Error(err);
					});
					cb!();
				}, async () => {
					await jiraClient.issues.doTransition({
						issueIdOrKey: link.jiraId!,
						transition: { id: '121' },
					}).catch((err) => {
						console.log(err);
						clipQueue.shift();
						clipQueue.start();
						throw new Error(err);
					});
					cb!();
				}).catch((err) => {
					console.log(err.response.data);
					throw new Error(err);
				});
			});
		} else {
			let languages = '';

			// eslint-disable-next-line no-return-assign
			req.body.issue.fields![config.jira.fields.langs].map((language: JiraField) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

			const row = new MessageActionRow()
				.addComponents(
					new MessageButton()
						.setCustomId(`assignToMe:${req.body.issue.key}`)
						.setLabel('Assign to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490'),
				);

			if (req.body.issue.fields!.status.name === link.status) {
				const embed = new MessageEmbed()
					.setTitle(`${req.body.issue.key}`)
					.setColor('#0052cc')
					.setDescription(req.body.issue.fields!.summary || 'No description available')
					.addField('Status', req.body.issue.fields!.status.name, true)
					.addField('Assignee', msg.embeds[0].fields[1].value, true)
					.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
					.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
					.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

				msg.edit({
					embeds: [embed],
					components: (req.body.issue.fields!.assignee === null ? [row] : []),
				});
			} else {
				// eslint-disable-next-line max-len
				const newChannelLink = await RoleLink.findById(req.body.issue.fields!.status.name).lean().exec()
					.catch((err) => {
						throw err;
					});

				// eslint-disable-next-line consistent-return
				if (!newChannelLink) return console.warn(`No channel link found for: ${req.body.issue.fields!.status.name}`);

				const newChannel = await client.channels.fetch(newChannelLink.discordChannelId)
					.catch((err) => {
						throw new Error(err);
					}) as unknown as BaseGuildTextChannel | null;

				if (newChannel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${channelLink.discordChannelId} is not a guild text channel`);

				const embed = new MessageEmbed()
					.setTitle(`${req.body.issue.key}`)
					.setColor('#0052cc')
					.setDescription(req.body.issue.fields!.summary || 'No description available')
					.addField('Status', req.body.issue.fields!.status.name, true)
					.addField('Assignee', 'Unassigned', true)
					.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
					.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
					.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

				const newMsg = await newChannel.send({ embeds: [embed], components: [row] });

				link.discordMessageId = newMsg.id;
				link.status = req.body.issue.fields!.status.name;

				await link.save();

				msg.delete();
			}
		}
	}
});

router.post('/webhook/artist', (req, res) => {
	if (req.query.token !== config.webhookSecret) {
		res.status(403).end();
		return;
	}
	res.status(200).end();
});

// TODO: Timer for auto assignment and stale
