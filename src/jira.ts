// Imports
import { Router, Request } from 'express';
import {
	BaseGuildTextChannel, MessageActionRow, MessageButton, MessageEmbed, TextChannel,
} from 'discord.js';
import axios, { AxiosResponse } from 'axios';
import cron from 'node-cron';
import { Document } from 'mongoose';
import { logger, client, jiraClient } from './index';

// Models
import IdLink, { Project } from './models/IdLink';
import { components } from './types/jira';
import StatusLink from './models/StatusLink';
import UserInfo from './models/UserInfo';
import GroupLink from './models/GroupLink';
import checkValid from './lib/checkValid';
import Setting from './models/Setting';
import sendUserAssignedEmbed from './lib/sendUserAssignedEmbed';

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
		if (!channelLink) return logger.warn(`No channel link for ${req.body.issue.fields!.status.name} found!`);

		const channel = await client.channels.fetch(channelLink.channel)
			.catch((err) => {
				throw new Error(err);
			}) as unknown as BaseGuildTextChannel | null;

		if (channel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${channelLink.channel} is not a guild text channel`);

		const link = new IdLink({
			jiraId: req.body.issue.id,
			type: 'translation',
			status: req.body.issue.fields!.status.name,
			// eslint-disable-next-line max-len
			languages: req.body.issue.fields![config.jira.fields.langs].map((language: JiraField) => language.value),
			lastUpdate: new Date(),
			lastStatusChange: new Date(),
		});

		const embed = new MessageEmbed()
			.setTitle(`${req.body.issue.key}`)
			.setColor('#0052cc')
			.setDescription(req.body.issue.fields!.summary ?? 'No description available')
			.addField('Status', req.body.issue.fields!.status.name)
			.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
			.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
			.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

		// TODO: create button to pick up, somehow needs to run as the user that clicked it
		const msg = await channel.send({ content: 'A new project is available and can be picked up in Jira', embeds: [embed] })
			.catch((err) => {
				throw new Error(err);
			});
		link.discordMessageId = msg.id;
		link.save((err) => {
			if (err) throw err;
		});
	} else {
		// Get the project from the db
		const link = await IdLink.findOne({ jiraId: req.body.issue.id })
			.exec()
			.catch((err) => {
				throw err;
			});
		if (!link || link.finished || link.abandoned) return;

		const statusLink = await StatusLink.findById(link.status).lean().exec()
			.catch((err) => {
				throw err;
			});

		const transitionName = req.body.transition && req.body.transition.name;

		if (transitionName === 'Uploaded' || transitionName === 'Abandon project') {
			if (statusLink && link.discordMessageId) {
				const channel = await client.channels.fetch(statusLink.channel)
					.catch((err) => {
						throw new Error(err);
					}) as unknown as BaseGuildTextChannel | null;

				if (channel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${statusLink.channel} is not a guild text channel`);

				const msg = await channel.messages.fetch(link.discordMessageId)
					.catch((err) => {
						throw new Error(err);
					});
				await msg.delete();
			}
			if (transitionName === 'Uploaded') link.finished = true;
			if (transitionName === 'Abandon project') link.abandoned = true;
			link.save((err) => {
				if (err) throw err;
			});
			return;
		} if (transitionName === 'Send to Ikari') {
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
				logger.error(err.response.data);
				throw new Error(err);
			}) as AxiosResponse<any>;

			const discordUser = await client.users.fetch(user._id)
				.catch((err) => {
					logger.error(err);
					throw err;
				});

			discordUser.send(strings.IkariClippingNotAvailable);
			return;
		}

		// If the status doesn't have a Discord channel linked to it or the project has no message
		if (!statusLink || !link.discordMessageId) {
			logger.warn(`No link found for: ${link.status}`);
			// TODO: cleanup
			// Only do something with the project if there's a status change
			if (req.body.issue.fields!.status.name !== link.status) {
				const row = new MessageActionRow()
					.addComponents(
						new MessageButton()
							.setCustomId(`assignToMe:${req.body.issue.key}`)
							.setLabel('Assign to me')
							.setStyle('SUCCESS')
							.setEmoji('819518919739965490'),
					);

				// Unassign all users who were assigned in the previous status
				const assignedUsers = await UserInfo.find({ assignedTo: req.body.issue.key }).exec();
				assignedUsers.forEach((user) => {
					/* eslint-disable no-param-reassign */
					user.isAssigned = false;
					user.lastAssigned = new Date();
					user.assignedAs = undefined;
					user.assignedTo = undefined;
					user.save((err) => {
						if (err) logger.error(err);
					});
					/* eslint-enable */
				});

				// If the new status is uploaded, we only need to update the document in the db
				if (req.body.issue.fields!.status.name === 'Uploaded') {
					link.discordMessageId = undefined;
					link.status = req.body.issue.fields!.status.name;
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.updateRequest = 0;
					link.hasAssignment = 0;
					link.finished = true;

					await link.save();
					return;
				}

				// eslint-disable-next-line max-len
				const newStatusLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
					.catch((err) => {
						throw err;
					});

				if (!newStatusLink) {
					logger.warn(`No channel link found for: ${req.body.issue.fields!.status.name}`);
					link.discordMessageId = undefined;
					link.status = req.body.issue.fields!.status.name;
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.updateRequest = 0;
					link.hasAssignment = 0;

					await link.save();
					return;
				}

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
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
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
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.lqcLastUpdate = new Date();
					link.sqcLastUpdate = new Date();
					link.updateRequest = 0;
					link.hasAssignment = 0;

					await link.save();
				} else if (req.body.issue.fields!.status.name === 'Ready for release') {
					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
						.addField('Status', req.body.issue.fields!.status.name)
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						content: 'New project ready for release',
						embeds: [embed],
					});

					link.discordMessageId = newMsg.id;
					link.status = req.body.issue.fields!.status.name;
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.updateRequest = 0;
					link.hasAssignment = 0;

					await link.save();
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
							logger.error(err.response.data);
							throw new Error(err);
						}) as AxiosResponse<any>;
						user = data;
						link.hasAssignment = (1 << 0);
					} else {
						link.hasAssignment = 0;
					}

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
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
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.updateRequest = 0;

					await link.save();
				}
			}
			return;
		}

		const channel = await client.channels.fetch(statusLink.channel)
			.catch((err) => {
				throw new Error(err);
			}) as unknown as BaseGuildTextChannel | null;

		if (channel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${statusLink.channel} is not a guild text channel`);

		const msg = await channel.messages.fetch(link.discordMessageId!)
			.catch((err) => {
				throw new Error(err);
			});

		if (transitionName === 'Assign') {
			if (req.body.issue.fields!.assignee === null) {
				if (link.hasAssignment & (1 << 0)) {
					link.hasAssignment -= (1 << 0);
					link.save((err) => {
						logger.error(err);
					});
					const user = await UserInfo.findOne({ assignedTo: link.jiraId }).exec()
						.catch((err) => {
							logger.log(err);
						});
					if (!user) return;
					user.isAssigned = false;
					user.assignedAs = undefined;
					user.assignedTo = undefined;
					user.lastAssigned = new Date();
					user.save((err) => {
						if (err) logger.error(err);
					});

					if (link.updateRequest & (1 << 0)) {
						link.updateRequest -= (1 << 0);
						link.save((err) => {
							if (err) logger.error(err);
						});
					}
				}

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
					logger.info(err.response.data);
					throw new Error(err);
				}) as AxiosResponse<any>;

				const previousAssignedUser = await UserInfo.findOne({
					isAssigned: true,
					assignedTo: req.body.issue.key,
				}).exec();
				if (previousAssignedUser) {
					previousAssignedUser.isAssigned = false;
					previousAssignedUser.assignedAs = undefined;
					previousAssignedUser.assignedTo = undefined;
					previousAssignedUser.lastAssigned = new Date();
					previousAssignedUser.save((err) => {
						if (err) logger.error(err);
					});
				}

				if (link.updateRequest & (1 << 0)) {
					link.updateRequest -= (1 << 0);
					link.save((err) => {
						if (err) logger.error(err);
					});
				}
				if (!(link.hasAssignment & (1 << 0))) {
					link.hasAssignment += (1 << 0);
					link.save((err) => {
						if (err) {
							logger.error(err);
							throw err;
						}
					});
				}

				let userDoc = await UserInfo.findById(user._id).exec();
				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}
				userDoc.isAssigned = true;
				userDoc.lastAssigned = new Date();
				userDoc.assignedTo = req.body.issue.key;
				link.lastUpdate = new Date();
				userDoc.save((err) => {
					if (err) {
						logger.error(err);
					}
				});
				link.save((err) => {
					if (err) {
						logger.error(err);
					}
				});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: `<@${user._id}>`,
				} as any);
				msg.edit({ embeds: [embed] });
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => logger.error(err));
			}
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

				if (link.hasAssignment & (1 << 1)) {
					link.hasAssignment -= (1 << 1);
					link.save((err) => {
						logger.error(err);
					});
					const user = await UserInfo.findOne({ assignedTo: link.jiraId, assignedAs: 'lqc' }).exec()
						.catch((err) => {
							logger.log(err);
						});
					if (!user) return;
					user.isAssigned = false;
					user.assignedAs = undefined;
					user.assignedTo = undefined;
					user.lastAssigned = new Date();
					user.save((err) => {
						if (err) logger.error(err);
					});

					if (link.updateRequest & (1 << 1)) {
						link.updateRequest -= (1 << 1);
						link.save((err) => {
							if (err) logger.error(err);
						});
					}
				}
			} else {
				const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields![config.jira.fields.LQCAssignee].key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch((err) => {
					logger.error(err.response.data);
					throw new Error(err);
				}) as AxiosResponse<any>;

				const previousAssignedUser = await UserInfo.findOne({
					isAssigned: true,
					assignedTo: req.body.issue.key,
					assignedAs: 'lqc',
				}).exec();
				if (previousAssignedUser) {
					previousAssignedUser.isAssigned = false;
					previousAssignedUser.assignedAs = undefined;
					previousAssignedUser.assignedTo = undefined;
					previousAssignedUser.lastAssigned = new Date();
					previousAssignedUser.save((err) => {
						if (err) logger.error(err);
					});
				}

				if (link.updateRequest & (1 << 1)) {
					link.updateRequest -= (1 << 1);
					link.save((err) => {
						if (err) logger.error(err);
					});
				}
				if (!(link.hasAssignment & (1 << 1))) {
					link.hasAssignment += (1 << 1);
					link.save((err) => {
						if (err) {
							logger.error(err);
							throw err;
						}
					});
				}

				let userDoc = await UserInfo.findById(user._id).exec();
				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}
				userDoc.isAssigned = true;
				userDoc.lastAssigned = new Date();
				userDoc.assignedTo = req.body.issue.key;
				userDoc.assignedAs = 'lqc';
				link.lqcLastUpdate = new Date();
				userDoc.save((err) => {
					if (err) {
						logger.error(err);
					}
				});
				link.save((err) => {
					if (err) {
						logger.error(err);
					}
				});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'LQC Assignee',
					value: `<@${user._id}>`,
				} as any);
				msg.edit({ embeds: [embed] });
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => logger.error(err));
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

				const embed = msg.embeds[0].spliceFields(2, 1, {
					name: 'SubQC Assignee',
					value: 'Unassigned',
				} as any);
				msg.edit({ embeds: [embed], components: [row] });

				if (link.hasAssignment & (1 << 2)) {
					link.hasAssignment -= (1 << 2);
					link.save((err) => {
						logger.error(err);
					});
					const user = await UserInfo.findOne({ assignedTo: link.jiraId, assignedAs: 'sqc' }).exec()
						.catch((err) => {
							logger.log(err);
						});
					if (!user) return;
					user.isAssigned = false;
					user.assignedAs = undefined;
					user.assignedTo = undefined;
					user.lastAssigned = new Date();
					user.save((err) => {
						if (err) logger.error(err);
					});

					if (link.updateRequest & (1 << 2)) {
						link.updateRequest -= (1 << 2);
						link.save((err) => {
							if (err) logger.error(err);
						});
					}
				}
			} else {
				const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields![config.jira.fields.SubQCAssignee].key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch((err) => {
					logger.log(err.response.data);
					throw new Error(err);
				}) as AxiosResponse<any>;

				const previousAssignedUser = await UserInfo.findOne({
					isAssigned: true,
					assignedTo: req.body.issue.key,
					assignedAs: 'sqc',
				}).exec();
				if (previousAssignedUser) {
					previousAssignedUser.isAssigned = false;
					previousAssignedUser.assignedAs = undefined;
					previousAssignedUser.assignedTo = undefined;
					previousAssignedUser.lastAssigned = new Date();
					previousAssignedUser.save((err) => {
						if (err) logger.error(err);
					});
				}

				if (link.updateRequest & (1 << 2)) {
					link.updateRequest -= (1 << 2);
					link.save((err) => {
						if (err) logger.error(err);
					});
				}
				if (!(link.hasAssignment & (1 << 2))) {
					link.hasAssignment += (1 << 2);
					link.save((err) => {
						if (err) {
							logger.error(err);
							throw err;
						}
					});
				}

				let userDoc = await UserInfo.findById(user._id).exec();
				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}
				userDoc.isAssigned = true;
				userDoc.lastAssigned = new Date();
				userDoc.assignedTo = req.body.issue.key;
				userDoc.assignedAs = 'sqc';
				link.sqcLastUpdate = new Date();
				userDoc.save((err) => {
					if (err) {
						logger.error(err);
					}
				});
				link.save((err) => {
					if (err) {
						logger.error(err);
					}
				});

				const embed = msg.embeds[0].spliceFields(2, 1, {
					name: 'SubQC Assignee',
					value: `<@${user._id}>`,
				} as any);
				msg.edit({ embeds: [embed] });
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => logger.error(err));
			}
		} else {
			// eslint-disable-next-line max-len
			link.languages = req.body.issue.fields![config.jira.fields.langs].map((language: JiraField) => language.value);
			link.save((err) => {
				if (err) logger.error(err);
			});

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
						.setDescription(req.body.issue.fields!.summary ?? 'No description available')
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
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
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
				const assignedUsers = await UserInfo.find({ assignedTo: req.body.issue.key }).exec();
				// eslint-disable-next-line array-callback-return
				assignedUsers.map((user) => {
					/* eslint-disable no-param-reassign */
					user.isAssigned = false;
					user.lastAssigned = new Date();
					user.assignedAs = undefined;
					user.assignedTo = undefined;
					user.save((err) => {
						if (err) logger.error(err);
					});
					/* eslint-enable */
				});

				// eslint-disable-next-line max-len
				const newStatusLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
					.catch((err) => {
						throw err;
					});

				if (!newStatusLink) {
					logger.warn(`No channel link found for: ${req.body.issue.fields!.status.name}`);
					link.discordMessageId = undefined;
					link.status = req.body.issue.fields!.status.name;
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.updateRequest = 0;
					link.hasAssignment = 0;

					await link.save();
					return;
				}

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
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
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
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.lqcLastUpdate = new Date();
					link.sqcLastUpdate = new Date();
					link.updateRequest = 0;
					link.hasAssignment = 0;

					await link.save();

					msg.delete();
				} else if (req.body.issue.fields!.status.name === 'Ready for release') {
					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
						.addField('Status', req.body.issue.fields!.status.name)
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						content: 'New project ready for release',
						embeds: [embed],
					});

					link.discordMessageId = newMsg.id;
					link.status = req.body.issue.fields!.status.name;
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.updateRequest = 0;
					link.hasAssignment = 0;

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
							logger.error(err.response.data);
							throw new Error(err);
						}) as AxiosResponse<any>;
						user = data;
						link.hasAssignment = (1 << 0);
					} else {
						link.hasAssignment = 0;
					}

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
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
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.updateRequest = 0;

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

async function autoAssign(project: Project, role?: 'sqc' | 'lqc'): Promise<void> {
	const hiatusRole = await GroupLink.findOne({ jiraName: 'Hiatus' }).exec();

	const available = await UserInfo.find({
		roles: {
			// Set to something impossible when the hiatus role cannot be found
			$ne: hiatusRole?._id ?? '0000',
		},
		isAssigned: false,
	}).sort({ lastAssigned: 'desc' }).exec();

	const guild = await client.guilds.fetch(config.discord.guild)
		.catch((err) => {
			logger.error(err);
		});

	if (!guild) return;

	const filteredAvailable = available.filter(async (user) => {
		const member = await guild.members.fetch(user._id)
			.catch((err) => {
				logger.error(err);
			});
		if (!member) return false;
		return checkValid(member, project.status, project.languages, role);
	});
	if (filteredAvailable.length === 0) {
		logger.info(`Somehow, there's no one available for: ${project.jiraId}`);
		return;
	}

	const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
		params: { id: filteredAvailable[0]._id },
		auth: {
			username: config.oauthServer.clientId,
			password: config.oauthServer.clientSecret,
		},
	}).catch((err) => {
		logger.log(err.response.data);
		throw new Error(err);
	}) as AxiosResponse<any>;

	const discordUser = await client.users.fetch(filteredAvailable[0]._id)
		.catch((err) => {
			logger.error(err);
		});
	if (!discordUser) return;

	// Role is only set in SQC/LQC status
	if (role) {
		if (role === 'sqc') {
			await jiraClient.issues.doTransition({
				issueIdOrKey: project.jiraId!,
				fields: {
					[config.jira.fields.SubQCAssignee]: {
						name: user.username,
					},
				},
				transition: {
					id: config.jira.transitions['Assign SubQC'],
				},
			});
		} else if (role === 'lqc') {
			await jiraClient.issues.doTransition({
				issueIdOrKey: project.jiraId!,
				fields: {
					[config.jira.fields.LQCAssignee]: {
						name: user.username,
					},
				},
				transition: {
					id: config.jira.transitions['Assign LQC'],
				},
			});
		}
		await discordUser.send(`You have been auto assigned to ${project.jiraId}.`);
	} else {
		await jiraClient.issues.doTransition({
			issueIdOrKey: project.jiraId!,
			fields: {
				assignee: {
					name: user.username,
				},
			},
			transition: {
				id: config.jira.transitions.Assign,
			},
		});
		await discordUser.send(`You have been auto assigned to ${project.jiraId}.`);
	}
}

async function projectStaleCheckRequest(project: Project) {
	if (project.status === 'Sub QC/Language QC') {
		const compareDate = new Date(Date.now() - 4 * 24 * 3600 * 1000);

		if (project.lqcLastUpdate! < compareDate) {
			// eslint-disable-next-line no-param-reassign
			project.updateRequest += (1 << 1);

			const user = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: project.jiraId,
				assignedAs: 'lqc',
			}).exec();

			if (user) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						logger.error(err);
					});
				if (discordUser) {
					const embed = new MessageEmbed()
						.setTitle(`Requesting update for: **${project.jiraId}**`)
						.setDescription(`Last update on this project was <t:${Math.floor(new Date(project.lqcLastUpdate!).getTime() / 1000)}:>`)
						.setURL(`https://jira.hlresort.community/browse/${project.jiraId}`);

					const componentRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setCustomId(`dontStale:${project.jiraId}`)
								.setLabel('Do not stale project'),
						)
						.addComponents(
							new MessageButton()
								.setCustomId(`abandonProject:${project.jiraId}`)
								.setLabel('Abandon project'),
						);
					await discordUser.send({ embeds: [embed], components: [componentRow] });
					user.updateRequested = new Date();
					await user.save();
				}
			}
		}
		if (project.sqcLastUpdate! < compareDate) {
			// eslint-disable-next-line no-param-reassign
			project.updateRequest += (1 << 2);

			const user = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: project.jiraId,
				assignedAs: 'sqc',
			}).exec();

			if (user) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						logger.error(err);
					});
				if (discordUser) {
					const embed = new MessageEmbed()
						.setTitle(`Requesting update for: **${project.jiraId}**`)
						.setDescription(`Last update on this project was <t:${Math.floor(new Date(project.sqcLastUpdate!).getTime() / 1000)}:>`)
						.setURL(`https://jira.hlresort.community/browse/${project.jiraId}`);

					const componentRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setCustomId(`dontStale:${project.jiraId}`)
								.setLabel('Do not stale project'),
						)
						.addComponents(
							new MessageButton()
								.setCustomId(`abandonProject:${project.jiraId}`)
								.setLabel('Abandon project'),
						);
					await discordUser.send({ embeds: [embed], components: [componentRow] });
					user.updateRequested = new Date();
					await user.save();
				}
			}
		}
	} else {
		const user = await UserInfo.findOne({
			isAssigned: true,
			assignedTo: project.jiraId,
		}).exec();

		if (user) {
			const discordUser = await client.users.fetch(user._id)
				.catch((err) => {
					logger.error(err);
				});
			if (discordUser) {
				const embed = new MessageEmbed()
					.setTitle(`Requesting update for: **${project.jiraId}**`)
					.setDescription(`Last update on this project was <t:${Math.floor(new Date(project.lastUpdate).getTime() / 1000)}:>`)
					.setURL(`https://jira.hlresort.community/browse/${project.jiraId}`);

				const componentRow = new MessageActionRow()
					.addComponents(
						new MessageButton()
							.setCustomId(`dontStale:${project.jiraId}`)
							.setLabel('Do not stale project'),
					)
					.addComponents(
						new MessageButton()
							.setCustomId(`abandonProject:${project.jiraId}`)
							.setLabel('Abandon project'),
					);
				await discordUser.send({ embeds: [embed], components: [componentRow] });
				user.updateRequested = new Date();
				await user.save();
			}
		}
	}
}

async function projectUpdateRequestCheck(project: Document<any, any, Project> & Project) {
	const compareDate = new Date(Date.now() - 3 * 24 * 3600 * 1000);

	if (project.status === 'Sub QC/Language QC') {
		if (project.updateRequest & (1 << 1)) {
			const user = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: project.jiraId,
				assignedAs: 'lqc',
			}).exec();

			if (user && (user.updateRequested! <= compareDate)) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						logger.error(err);
					});

				if (discordUser) {
					await jiraClient.issues.doTransition({
						issueIdOrKey: project.jiraId!,
						fields: {
							assignee: {
								name: null,
							},
						},
						transition: {
							id: config.jira.transitions['Assign LQC'],
						},
					});

					await discordUser.send(`I have not received an update in time, considering abandoned and auto un-assigning you from: ${project.jiraId}`);

					/* eslint-disable no-param-reassign */
					project.staleCount += 1;
					/* eslint-enable */
					await project.save();
				}
			}
		}

		if (project.updateRequest & (1 << 2)) {
			const user = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: project.jiraId,
				assignedAs: 'lqc',
			}).exec();

			if (user && (user.updateRequested! <= compareDate)) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						logger.error(err);
					});

				if (discordUser) {
					await jiraClient.issues.doTransition({
						issueIdOrKey: project.jiraId!,
						fields: {
							assignee: {
								name: null,
							},
						},
						transition: {
							id: config.jira.transitions['Assign SubQC'],
						},
					});

					await discordUser.send(`I have not received an update in time, considering abandoned and auto un-assigning you from: ${project.jiraId}`);

					/* eslint-disable no-param-reassign */
					project.staleCount += 1;
					/* eslint-enable */
					await project.save();
				}
			}
		}
	} else {
		const user = await UserInfo.findOne({
			isAssigned: true,
			assignedTo: project.jiraId,
		}).exec();

		if (user && (user.updateRequested! <= compareDate)) {
			const discordUser = await client.users.fetch(user._id)
				.catch((err) => {
					logger.error(err);
				});

			if (discordUser) {
				await jiraClient.issues.doTransition({
					issueIdOrKey: project.jiraId!,
					fields: {
						assignee: {
							name: null,
						},
					},
					transition: {
						id: config.jira.transitions.Assign,
					},
				});

				await discordUser.send(`I have not received an update in time, considering abandoned and auto un-assigning you from: ${project.jiraId}`);

				/* eslint-disable no-param-reassign */
				project.staleCount += 1;
				/* eslint-enable */
				await project.save();
			}
		}
	}
}

async function staleAnnounce(project: Document<any, any, Project> & Project) {
	const teamLeadNotifySetting = await Setting.findById('teamLeadNotifyChannel').exec();

	if (teamLeadNotifySetting) {
		const channel = await client.channels.fetch(teamLeadNotifySetting.value)
			.catch((err) => {
				logger.error(err);
			}) as TextChannel;
		if (channel) {
			await channel.send(`${project.jiraId} has not transitioned in three weeks!`);
		}
	}

	// eslint-disable-next-line no-param-reassign
	project.abandoned = true;
	await project.save();
}

cron.schedule('0 * * * *', async () => {
	const toAutoAssign = await IdLink.find({
		$or: [
			{
				status: 'Sub QC/Language QC',
				hasAssignment: { $lte: (1 << 1) + (1 << 2) },
			},
			{
				hasAssignment: 0,
			},
		],
		$not: {
			$or: [
				// Ignore certain statuses and projects that do not have a message in Discord
				{
					status: 'Open',
				},
				{
					status: 'Being clipped',
				},
				{
					status: 'Ready for release',
				},
				{
					discordMessageId: undefined,
				},
			],
		},
		finished: false,
		abandoned: false,
		// TODO: Make the lastUpdate query dynamic
		lastUpdate: { $lte: new Date(Date.now() - (3 * 24 * 3600 * 1000)) },
	}).exec();

	toAutoAssign.forEach((project) => {
		if (project.status === 'Sub QC/Language QC') {
			if (!(project.hasAssignment & (1 << 1))) {
				autoAssign(project, 'lqc');
			}
			if (!(project.hasAssignment & (1 << 2))) {
				autoAssign(project, 'sqc');
			}
		} else {
			autoAssign(project);
		}
	});

	const toRequestUpdate = await IdLink.find({
		$or: [
			{
				status: 'Sub QC/Language QC',
				updateRequest: { $lt: (1 << 1) + (1 << 2) },
				$or: [
					{
						sqcLastUpdate: { $lte: new Date(Date.now() - (3 * 24 * 3600 * 1000)) },
					},
					{
						lqcLastUpdate: { $lte: new Date(Date.now() - (3 * 24 * 3600 * 1000)) },
					},
				],
			},
			{
				lastUpdate: { $lte: new Date(Date.now() - (3 * 24 * 3600 * 1000)) },
				updateRequest: { $ne: 1 },
			},
		],
		hasAssignment: { $gte: 1 },
	}).exec();

	toRequestUpdate.forEach((project) => {
		projectStaleCheckRequest(project);
	});

	const toCheckUpdateRequest = await IdLink.find({
		updateRequest: { $gte: 1 },
		hasAssignment: { $gte: 1 },
	}).exec();

	toCheckUpdateRequest.forEach((project) => {
		projectUpdateRequestCheck(project);
	});

	const toNotifyStale = await IdLink.find({
		lastStatusChange: {
			$lte: new Date(Date.now() - 3 * 7 * 24 * 3600 * 1000),
		},
	});

	toNotifyStale.forEach((project) => {
		staleAnnounce(project);
	});
});
