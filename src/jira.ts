/* eslint-disable no-console */
// Imports
import { Router, Request } from 'express';
import {
	BaseGuildTextChannel, MessageActionRow, MessageButton, MessageEmbed,
} from 'discord.js';
import axios, { AxiosResponse } from 'axios';
import cron from 'node-cron';

// Models
import IdLink, { Project } from './models/IdLink';
import { client, jiraClient } from './index';
import { components } from './types/jira';
import StatusLink from './models/StatusLink';
import UserInfo from './models/UserInfo';
import GroupLink from './models/GroupLink';

// Local files
const config = require('../config.json');
const strings = require('../strings.json');

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
	// TODO: Re-add language field
	if (req.query.token !== config.webhookSecret) {
		res.status(403).end();
		return;
	}
	res.status(200).end();

	if (req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') {
		const channelLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
			.catch((err) => {
				throw new Error(err);
			});

		// eslint-disable-next-line consistent-return
		if (!channelLink) return console.warn(`No channel link for ${req.body.issue.fields!.status.name} found!`);

		const channel = await client.channels.fetch(channelLink.channel)
			.catch((err) => {
				throw new Error(err);
			}) as unknown as BaseGuildTextChannel | null;

		if (channel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${channelLink.channel} is not a guild text channel`);

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
			.addField('Status', req.body.issue.fields!.status.name)
			.addField('Assignee', 'Unassigned')
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

		const channelLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
			.catch((err) => {
				throw err;
			});

		// eslint-disable-next-line consistent-return
		if (!channelLink) return console.warn(`No channel link found for: ${link.status}`);

		const channel = await client.channels.fetch(channelLink.channel)
			.catch((err) => {
				throw new Error(err);
			}) as unknown as BaseGuildTextChannel | null;

		if (channel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${channelLink.channel} is not a guild text channel`);

		const msg = await channel.messages.fetch(link.discordMessageId!)
			.catch((err) => {
				throw new Error(err);
			});

		const transitionName = req.body.transition && req.body.transition.name;

		if (transitionName === 'Assign') {
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
				const status = req.body.issue.fields!.status.name;
				msg.edit({ embeds: [embed], components: (status === 'Open' || status === 'Rejected' || status === 'Being clipped' || status === 'Uploaded') ? [] : [row] });
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

				let userDoc = await UserInfo.findById(user._id).exec();
				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}
				userDoc.isAssigned = true;
				userDoc.lastAssigned = new Date();
				// @ts-expect-error isAssigned possibly false
				userDoc.assignedTo = req.body.issue.key;
				link.lastUpdate = new Date();
				// @ts-expect-error no overload match
				userDoc.save((err) => {
					if (err) {
						console.error(err);
					}
				});
				link.save((err) => {
					if (err) {
						console.error(err);
					}
				});

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
		} else if (transitionName === 'Finish') {
			msg.delete();
			link.finished = true;
			link.save((err) => {
				if (err) throw err;
			});
		} else if (transitionName === 'Send to Ikari') {
			await jiraClient.issues.doTransition({
				issueIdOrKey: req.body.issue.key!,
				transition: {
					name: 'Send to translator',
				},
			});

			const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
				params: { key: req.body.user.key },
				auth: {
					username: config.oauthServer.clientId,
					password: config.oauthServer.clientSecret,
				},
			}).catch((err) => {
				console.error(err.response.data);
				throw new Error(err);
			}) as AxiosResponse<any>;

			const discordUser = await client.users.fetch(user._id)
				.catch((err) => {
					console.error(err);
					throw err;
				});

			discordUser.send(strings.IkariClippingNotAvailable);
		} else if (transitionName === 'Assign LQC') {
			if (req.body.issue.fields![config.jira.fields.LQCAssignee] === null) {
				const row = new MessageActionRow()
					.addComponents(
						new MessageButton()
							.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
							.setLabel('Assign LQC to me')
							.setStyle('SUCCESS')
							.setEmoji('819518919739965490'),
					);
				if (req.body.issue.fields![config.jira.fields.SubQCAssignee] === null) {
					row.addComponents(
						new MessageButton()
							.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
							.setLabel('Assign SubQC to me')
							.setStyle('SUCCESS')
							.setEmoji('819518919739965490'),
					);
				}

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'LQC Assignee',
					value: 'Unassigned',
				} as any);
				msg.edit({ embeds: [embed], components: [row] });
			} else {
				const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields![config.jira.fields.LQCAssignee].key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch((err) => {
					console.log(err.response.data);
					throw new Error(err);
				}) as AxiosResponse<any>;

				let userDoc = await UserInfo.findById(user._id).exec();
				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}
				userDoc.isAssigned = true;
				userDoc.lastAssigned = new Date();
				// @ts-expect-error isAssigned possibly false
				userDoc.assignedTo = req.body.issue.key;
				link.lqcLastUpdate = new Date();
				// @ts-expect-error no overload match
				userDoc.save((err) => {
					if (err) {
						console.error(err);
					}
				});
				link.save((err) => {
					if (err) {
						console.error(err);
					}
				});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'LQC Assignee',
					value: `<@${user._id}>`,
				} as any);
				msg.edit({ embeds: [embed] });
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						fetchedUser.send({ content: 'New assignment', embeds: [embed] });
					}).catch(console.error);
			}
		} else if (transitionName === 'Assign SubQC') {
			if (req.body.issue.fields![config.jira.fields.SubQCAssignee] === null) {
				const row = new MessageActionRow()
					.addComponents(
						new MessageButton()
							.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
							.setLabel('Assign SubQC to me')
							.setStyle('SUCCESS')
							.setEmoji('819518919739965490'),
					);
				if (req.body.issue.fields![config.jira.fields.LQCAssignee] === null) {
					row.addComponents(
						new MessageButton()
							.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
							.setLabel('Assign LQC to me')
							.setStyle('SUCCESS')
							.setEmoji('819518919739965490'),
					);
				}

				const embed = msg.embeds[0].spliceFields(2, 2, {
					name: 'SubQC Assignee',
					value: 'Unassigned',
				} as any);
				msg.edit({ embeds: [embed], components: [row] });
			} else {
				const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields![config.jira.fields.SubQCAssignee].key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch((err) => {
					console.log(err.response.data);
					throw new Error(err);
				}) as AxiosResponse<any>;

				let userDoc = await UserInfo.findById(user._id).exec();
				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}
				userDoc.isAssigned = true;
				userDoc.lastAssigned = new Date();
				// @ts-expect-error isAssigned possibly false
				userDoc.assignedTo = req.body.issue.key;
				link.sqcLastUpdate = new Date();
				// @ts-expect-error no overload match
				userDoc.save((err) => {
					if (err) {
						console.error(err);
					}
				});
				link.save((err) => {
					if (err) {
						console.error(err);
					}
				});

				const embed = msg.embeds[0].spliceFields(2, 2, {
					name: 'SubQC Assignee',
					value: `<@${user._id}>`,
				} as any);
				msg.edit({ embeds: [embed] });
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						fetchedUser.send({ content: 'New assignment', embeds: [embed] });
					}).catch(console.error);
			}
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
				if (link.status === 'Sub QC/Language QC') {
					const newRow = new MessageActionRow();

					if (msg.embeds[0].fields[1].value === 'Unassigned') {
						newRow.addComponents(
							new MessageButton()
								.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
								.setLabel('Assign LQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490'),
						);
					}
					if (msg.embeds[0].fields[2].value === 'Unassigned') {
						newRow.addComponents(
							new MessageButton()
								.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
								.setLabel('Assign SubQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490'),
						);
					}

					const embed = new MessageEmbed()
						.setTitle(req.body.issue.key!)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.summary || 'No description available')
						.addField('Status', req.body.issue.fields!.status.name)
						.addField('LQC Assignee', msg.embeds[0].fields[1].value, true)
						.addField('SubQC Assignee', msg.embeds[0].fields[2].value, true)
						.addField('LQC Status',
							(
								// eslint-disable-next-line no-nested-ternary
								(req.body.issue.fields![config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'LQC_done').length > 0 ? 'Done' : (
									req.body.issue.fields![config.jira.fields.LQCAssignee] === null ? 'To do' : 'In progress'
								) ?? 'To do'
							))
						.addField('SubQC Status',
							(
								// eslint-disable-next-line no-nested-ternary
								(req.body.issue.fields![config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'Sub_QC_done').length > 0 ? 'Done' : (
									req.body.issue.fields![config.jira.fields.SubQCAssignee] === null ? 'To do' : 'In progress'
								) ?? 'To do'
							))
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					msg.edit({
						embeds: [embed],
						components: (msg.embeds[0].fields[1].value === 'Unassigned' || msg.embeds[0].fields[2].value === 'Unassigned' ? [newRow] : []),
					});
				} else {
					const embed = new MessageEmbed()
						.setTitle(req.body.issue.key!)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.summary || 'No description available')
						.addField('Status', req.body.issue.fields!.status.name)
						.addField('Assignee', msg.embeds[0].fields[1].value)
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					msg.edit({
						embeds: [embed],
						components: (req.body.issue.fields!.assignee === null ? [row] : []),
					});
				}
			} else {
				// eslint-disable-next-line max-len
				const newStatusLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
					.catch((err) => {
						throw err;
					});

				// eslint-disable-next-line consistent-return
				if (!newStatusLink) return console.warn(`No channel link found for: ${req.body.issue.fields!.status.name}`);

				const newChannel = await client.channels.fetch(newStatusLink.channel)
					.catch((err) => {
						throw new Error(err);
					}) as unknown as BaseGuildTextChannel | null;

				if (newChannel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${newStatusLink.channel} is not a guild text channel`);

				if (req.body.issue.fields!.status.name === 'Sub QC/Language QC') {
					const newRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
								.setLabel('Assign LQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490'),
						).addComponents(
							new MessageButton()
								.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
								.setLabel('Assign SubQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490'),
						);

					const embed = new MessageEmbed()
						.setTitle(req.body.issue.key!)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.summary || 'No description available')
						.addField('Status', req.body.issue.fields!.status.name)
						.addField('LQC Assignee', 'Unassigned', true)
						.addField('SubQC Assignee', 'Unassigned', true)
						.addField('LQC Status', 'To do', true)
						.addField('SubQC Status', 'To do', true)
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: (req.body.issue.fields!.assignee === null ? [newRow] : []),
					});

					link.discordMessageId = newMsg.id;
					link.status = req.body.issue.fields!.status.name;

					await link.save();

					msg.delete();
				} else {
					let user: any | undefined;
					if (req.body.issue.fields!.assignee !== null) {
						const { data } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
							params: { key: req.body.issue.fields!.assignee.key },
							auth: {
								username: config.oauthServer.clientId,
								password: config.oauthServer.clientSecret,
							},
						}).catch((err) => {
							console.log(err.response.data);
							throw new Error(err);
						}) as AxiosResponse<any>;
						user = data;
					}

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.summary || 'No description available')
						.addField('Status', req.body.issue.fields!.status.name)
						.addField('Assignee', user ? `<@${user._id}>` : 'Unassigned')
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: (req.body.issue.fields!.assignee === null ? [row] : []),
					});

					link.discordMessageId = newMsg.id;
					link.status = req.body.issue.fields!.status.name;

					await link.save();

					msg.delete();
				}
			}
		}
	}
});

// TODO: Handle artist work
router.post('/webhook/artist', (req, res) => {
	if (req.query.token !== config.webhookSecret) {
		res.status(403).end();
		return;
	}
	res.status(200).end();
});

// TODO: Create auto assign function
async function autoAssign(project: Project): Promise<void> {
	const statusLink = await StatusLink.findById(project.status).exec();
	const hiatusRole = await GroupLink.findOne({ jiraName: 'Hiatus' }).exec();
	const currentStatusRole = await GroupLink.findOne();

	const available = await UserInfo.find({
		roles: {
			$not: hiatusRole?._id ?? '0000',
		},
		isAssigned: false,
	}, null, {
		sort: {
			lastAssigned: 'desc',
		},
	}).exec();
}

cron.schedule('0 * * * *', async () => {
	// TODO: Timer for auto assignment and stale
});
