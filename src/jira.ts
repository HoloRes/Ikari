// Imports
import { Router, Request } from 'express';
import {
	BaseGuildTextChannel, MessageActionRow, MessageButton, MessageEmbed, TextChannel,
} from 'discord.js';
import axios from 'axios';
import cron from 'node-cron';
import { Document } from 'mongoose';
import format from 'string-template';
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
import { allServicesOnline } from './lib/middleware';

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
			jiraKey: req.body.issue.key,
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
		const link = await IdLink.findOne({ jiraKey: req.body.issue.key })
			.exec()
			.catch((err) => {
				throw err;
			});
		if (!link || link.finished || link.abandoned) return;

		const statusLink = await StatusLink.findById(link.status).lean().exec()
			.catch((err) => {
				throw err;
			});

		const transitionName = req.body.transition?.transitionName;

		if (req.body.issue.fields!.status.name === 'Open') {
			if (link.discordMessageId && statusLink) {
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
			} else if (link.discordMessageId) {
				// eslint-disable-next-line max-len
				const channelLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
					.catch((err) => {
						throw new Error(err);
					});

				if (!channelLink) {
					logger.warn(`No channel link for ${req.body.issue.fields!.status.name} found!`);
					return;
				}

				const channel = await client.channels.fetch(channelLink.channel)
					.catch((err) => {
						throw new Error(err);
					}) as unknown as BaseGuildTextChannel | null;

				if (channel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${channelLink.channel} is not a guild text channel`);

				const msg = await channel.messages.fetch(link.discordMessageId)
					.catch((err) => {
						logger.error(err);
					});
				if (!msg) return;
				await msg.delete();
			}

			// eslint-disable-next-line max-len
			const channelLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
				.catch((err) => {
					throw new Error(err);
				});

			if (!channelLink) {
				logger.warn(`No channel link for ${req.body.issue.fields!.status.name} found!`);
				return;
			}

			const channel = await client.channels.fetch(channelLink.channel)
				.catch((err) => {
					throw new Error(err);
				}) as unknown as BaseGuildTextChannel | null;

			if (channel?.type !== 'GUILD_TEXT') throw new Error(`Channel: ${channelLink.channel} is not a guild text channel`);

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
			link.status = req.body.issue.fields!.status.name;
			link.save((err) => {
				if (err) throw err;
			});
			return;
		}

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
		}
		if (transitionName === 'Send to Ikari') {
			await jiraClient.issues.doTransition({
				issueIdOrKey: req.body.issue.key!,
				transition: {
					id: config.jira.transitions['Send to translator'],
				},
			}).catch((err) => {
				throw err;
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
			});

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
							.setEmoji('819518919739965490')
							.setDisabled(req.body.issue.fields!.assignee !== null),
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

					await link.save((err) => {
						if (err) logger.error(err);
					});
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

					await link.save((err) => {
						if (err) logger.error(err);
					});
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
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields![config.jira.fields.LQCAssignee] !== null),
						).addComponents(
							new MessageButton()
								.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
								.setLabel('Assign SubQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields![config.jira.fields.SubQCAssignee] !== null),
						);

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
						.addField('Status', req.body.issue.fields!.status.name)
						.addField('LQC Assignee', 'Unassigned', true)
						.addField('SubQC Assignee', 'Unassigned', true)
						.addField('LQC Status', 'To do')
						.addField('SubQC Status', 'To do')
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: [newRow],
					});

					link.discordMessageId = newMsg.id;
					link.status = req.body.issue.fields!.status.name;
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.lqcLastUpdate = new Date();
					link.sqcLastUpdate = new Date();
					link.updateRequest = 0;
					link.hasAssignment = 0;

					await link.save((err) => {
						if (err) logger.error(err);
					});
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

					await link.save((err) => {
						if (err) logger.error(err);
					});
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
						});
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
						components: [row],
					});

					link.discordMessageId = newMsg.id;
					link.status = req.body.issue.fields!.status.name;
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.updateRequest = 0;

					await link.save((err) => {
						if (err) logger.error(err);
					});
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
			const row = new MessageActionRow()
				.addComponents(
					new MessageButton()
						.setCustomId(`assignToMe:${req.body.issue.key}`)
						.setLabel('Assign to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields!.assignee !== null),
				);

			if (req.body.issue.fields!.assignee === null) {
				if (link.hasAssignment & (1 << 0)) {
					link.hasAssignment -= (1 << 0);
					link.save((err) => {
						if (err) logger.error(err);
					});
					const user = await UserInfo.findOne({ assignedTo: link.jiraKey }).exec()
						.catch((err) => {
							if (err) logger.log(err);
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
				});

				const previousAssignedUser = await UserInfo.findOne({
					isAssigned: true,
					assignedTo: req.body.issue.key,
				}).exec();
				if (previousAssignedUser && previousAssignedUser._id !== user._id) {
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
					if (err) logger.error(err);
				});
				link.save((err) => {
					if (err) logger.error(err);
				});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: `<@${user._id}>`,
				} as any);

				msg.edit({ embeds: [embed], components: [row] });

				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => logger.error(err));
			}
		} else if (transitionName === 'Assign LQC') {
			const row = new MessageActionRow()
				.addComponents(
					new MessageButton()
						.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
						.setLabel('Assign LQC to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields![config.jira.fields.LQCAssignee] !== null),
				).addComponents(
					new MessageButton()
						.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
						.setLabel('Assign SubQC to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields![config.jira.fields.SubQCAssignee] !== null),
				);

			if (req.body.issue.fields![config.jira.fields.LQCAssignee] === null) {
				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'LQC Assignee',
					value: 'Unassigned',
					inline: true,
				} as any);
				msg.edit({ embeds: [embed], components: [row] });

				if (link.hasAssignment & (1 << 1)) {
					link.hasAssignment -= (1 << 1);
					link.save((err) => {
						if (err) logger.error(err);
					});
					const user = await UserInfo.findOne({ assignedTo: link.jiraKey, assignedAs: 'lqc' }).exec()
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
				});

				const previousAssignedUser = await UserInfo.findOne({
					isAssigned: true,
					assignedTo: req.body.issue.key,
					assignedAs: 'lqc',
				}).exec();
				if (previousAssignedUser && previousAssignedUser._id !== user._id) {
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
					if (err) logger.error(err);
				});
				link.save((err) => {
					if (err) logger.error(err);
				});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'LQC Assignee',
					value: `<@${user._id}>`,
					inline: true,
				} as any);
				msg.edit({ embeds: [embed], components: [row] });
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => logger.error(err));
			}
		} else if (transitionName === 'Assign SubQC') {
			const row = new MessageActionRow()
				.addComponents(
					new MessageButton()
						.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
						.setLabel('Assign LQC to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields![config.jira.fields.LQCAssignee] !== null),
				).addComponents(
					new MessageButton()
						.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
						.setLabel('Assign SubQC to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields![config.jira.fields.SubQCAssignee] !== null),
				);

			if (req.body.issue.fields![config.jira.fields.SubQCAssignee] === null) {
				const embed = msg.embeds[0].spliceFields(2, 1, {
					name: 'SubQC Assignee',
					value: 'Unassigned',
					inline: true,
				} as any);
				msg.edit({ embeds: [embed], components: [row] });

				if (link.hasAssignment & (1 << 2)) {
					link.hasAssignment -= (1 << 2);
					link.save((err) => {
						if (err) logger.error(err);
					});
					const user = await UserInfo.findOne({ assignedTo: link.jiraKey, assignedAs: 'sqc' }).exec()
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
				});

				const previousAssignedUser = await UserInfo.findOne({
					isAssigned: true,
					assignedTo: req.body.issue.key,
					assignedAs: 'sqc',
				}).exec();
				if (previousAssignedUser && previousAssignedUser._id !== user._id) {
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
					if (err) logger.error(err);
				});
				link.save((err) => {
					if (err) logger.error(err);
				});

				const embed = msg.embeds[0].spliceFields(2, 1, {
					name: 'SubQC Assignee',
					value: `<@${user._id}>`,
					inline: true,
				} as any);
				msg.edit({ embeds: [embed], components: [row] });

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
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields!.assignee !== null),
				);

			if (req.body.issue.fields!.status.name === link.status) {
				if (link.status === 'Sub QC/Language QC') {
					console.log(req.body);
					console.log(req.body.issue.fields![config.jira.fields.LQCSubQCFinished]);

					const newRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
								.setLabel('Assign LQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields![config.jira.fields.LQCAssignee] !== null),
						).addComponents(
							new MessageButton()
								.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
								.setLabel('Assign SubQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields![config.jira.fields.SubQCAssignee] !== null),
						);

					const embed = new MessageEmbed()
						.setTitle(req.body.issue.key!)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.summary ?? 'No description available')
						.addField('Status', req.body.issue.fields!.status.name)
						.addField('LQC Assignee', msg.embeds[0].fields[1].value, true)
						.addField('SubQC Assignee', msg.embeds[0].fields[2].value, true)
						.addField(
							'LQC Status',
							(
								// eslint-disable-next-line no-nested-ternary
								(req.body.issue.fields![config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'LQC_done') ? 'Done' : (
									req.body.issue.fields![config.jira.fields.LQCAssignee] === null ? 'To do' : 'In progress'
								) ?? 'To do'
							),
						)
						.addField(
							'SubQC Status',
							(
								// eslint-disable-next-line no-nested-ternary
								(req.body.issue.fields![config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'Sub_QC_done') ? 'Done' : (
									req.body.issue.fields![config.jira.fields.SubQCAssignee] === null ? 'To do' : 'In progress'
								) ?? 'To do'
							),
						)
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					msg.edit({
						embeds: [embed],
						components: [newRow],
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
						components: [row],
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

					await link.save((err) => {
						if (err) logger.error(err);
					});
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
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields![config.jira.fields.LQCAssignee] !== null),
						).addComponents(
							new MessageButton()
								.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
								.setLabel('Assign SubQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields![config.jira.fields.SubQCAssignee] !== null),
						);

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
						.addField('Status', req.body.issue.fields!.status.name)
						.addField('LQC Assignee', 'Unassigned', true)
						.addField('SubQC Assignee', 'Unassigned', true)
						.addField('LQC Status', 'To do')
						.addField('SubQC Status', 'To do')
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: [newRow],
					});

					link.discordMessageId = newMsg.id;
					link.status = req.body.issue.fields!.status.name;
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.lqcLastUpdate = new Date();
					link.sqcLastUpdate = new Date();
					link.updateRequest = 0;
					link.hasAssignment = 0;

					await link.save((err) => {
						if (err) logger.error(err);
					});

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

					await link.save((err) => {
						if (err) logger.error(err);
					});

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
						});
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
						components: [row],
					});

					link.discordMessageId = newMsg.id;
					link.status = req.body.issue.fields!.status.name;
					link.lastStatusChange = new Date();
					link.lastUpdate = new Date();
					link.updateRequest = 0;

					await link.save((err) => {
						if (err) logger.error(err);
					});

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

// Route so that Jira can test if everything is online
router.get('/webhook/test', async (req, res) => {
	if (req.query.token !== config.webhookSecret) {
		res.status(403).end();
		return;
	}
	const online = await allServicesOnline();
	res.status(200).send(online);
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
	if (available.length === 0) {
		logger.info(`Somehow, there's no one available for: ${project.jiraKey}`);
		return;
	}
	logger.debug(guild.name);

	const filteredAvailable = available.filter(async (user) => {
		const member = await guild.members.fetch(user._id)
			.catch((err) => {
				logger.error(err);
			});
		if (!member) return false;
		return checkValid(member, project.status, project.languages, role);
	});
	if (filteredAvailable.length === 0) {
		logger.info(`Somehow, there's no one available for: ${project.jiraKey}`);
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
	});

	const discordUser = await client.users.fetch(filteredAvailable[0]._id)
		.catch((err) => {
			logger.error(err);
		});
	if (!discordUser) return;

	// Role is only set in SQC/LQC status
	if (role) {
		if (role === 'sqc') {
			await jiraClient.issues.doTransition({
				issueIdOrKey: project.jiraKey!,
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
				issueIdOrKey: project.jiraKey!,
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
		await discordUser.send(format(strings.autoAssignedTo, { jiraKey: project.jiraKey }));
		// TODO: Add comment on Jira
	} else {
		await jiraClient.issues.doTransition({
			issueIdOrKey: project.jiraKey!,
			fields: {
				assignee: {
					name: user.username,
				},
			},
			transition: {
				id: config.jira.transitions.Assign,
			},
		});
		await discordUser.send(format(strings.autoAssignedTo, { jiraKey: project.jiraKey }));
		// TODO: Add comment on Jira
	}
}

async function projectStaleCheckRequest(project: Document<any, any, Project> & Project) {
	if (project.status === 'Sub QC/Language QC') {
		const compareDate = new Date(Date.now() - 4 * 24 * 3600 * 1000);

		if (project.lqcLastUpdate! < compareDate && !(project.updateRequest & (1 << 1))) {
			// eslint-disable-next-line no-param-reassign
			project.updateRequest += (1 << 1);

			const user = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: project.jiraKey,
				assignedAs: 'lqc',
			}).exec();

			if (user) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						logger.error(err);
					});
				if (discordUser) {
					const embed = new MessageEmbed()
						.setTitle(`Requesting update for: **${project.jiraKey}**`)
						.setDescription(`Last update on this project was <t:${Math.floor(new Date(project.lqcLastUpdate!).getTime() / 1000)}:D>`)
						.setURL(`https://jira.hlresort.community/browse/${project.jiraKey}`);

					const componentRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setStyle('SUCCESS')
								.setCustomId(`dontStale:${project.jiraKey}`)
								.setLabel('Do not stale project'),
						)
						.addComponents(
							new MessageButton()
								.setStyle('DANGER')
								.setCustomId(`abandonProject:${project.jiraKey}`)
								.setLabel('Abandon project'),
						);
					await discordUser.send({ embeds: [embed], components: [componentRow] });
					user.updateRequested = new Date();
					await user.save((err) => {
						if (err) logger.error(err);
					});
					await project.save((err) => {
						if (err) logger.error(err);
					});
				}
			}
		}
		if (project.sqcLastUpdate! < compareDate && !(project.updateRequest & (1 << 2))) {
			// eslint-disable-next-line no-param-reassign
			project.updateRequest += (1 << 2);

			const user = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: project.jiraKey,
				assignedAs: 'sqc',
			}).exec();

			if (user) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						logger.error(err);
					});
				if (discordUser) {
					const embed = new MessageEmbed()
						.setTitle(`Requesting update for: **${project.jiraKey}**`)
						.setDescription(`Last update on this project was <t:${Math.floor(new Date(project.sqcLastUpdate!).getTime() / 1000)}:D>`)
						.setURL(`https://jira.hlresort.community/browse/${project.jiraKey}`);

					const componentRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setStyle('SUCCESS')
								.setCustomId(`dontStale:${project.jiraKey}`)
								.setLabel('Do not stale project'),
						)
						.addComponents(
							new MessageButton()
								.setStyle('DANGER')
								.setCustomId(`abandonProject:${project.jiraKey}`)
								.setLabel('Abandon project'),
						);
					await discordUser.send({ embeds: [embed], components: [componentRow] });
					user.updateRequested = new Date();
					await user.save((err) => {
						if (err) logger.error(err);
					});
					await project.save((err) => {
						if (err) logger.error(err);
					});
				}
			}
		}
	} else {
		const user = await UserInfo.findOne({
			isAssigned: true,
			assignedTo: project.jiraKey,
		}).exec();

		if (user) {
			const discordUser = await client.users.fetch(user._id)
				.catch((err) => {
					logger.error(err);
				});
			if (discordUser) {
				const embed = new MessageEmbed()
					.setTitle(`Requesting update for: **${project.jiraKey}**`)
					.setDescription(`Last update on this project was <t:${Math.floor(new Date(project.lastUpdate).getTime() / 1000)}:D>`)
					.setURL(`https://jira.hlresort.community/browse/${project.jiraKey}`);

				const componentRow = new MessageActionRow()
					.addComponents(
						new MessageButton()
							.setStyle('SUCCESS')
							.setCustomId(`dontStale:${project.jiraKey}`)
							.setLabel('Do not stale project'),
					)
					.addComponents(
						new MessageButton()
							.setStyle('DANGER')
							.setCustomId(`abandonProject:${project.jiraKey}`)
							.setLabel('Abandon project'),
					);
				await discordUser.send({ embeds: [embed], components: [componentRow] });
				user.updateRequested = new Date();
				await user.save((err) => {
					if (err) logger.error(err);
				});
				await project.save((err) => {
					if (err) logger.error(err);
				});
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
				assignedTo: project.jiraKey,
				assignedAs: 'lqc',
			}).exec();

			if (user && (user.updateRequested! <= compareDate)) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						logger.error(err);
					});

				if (discordUser) {
					await jiraClient.issues.doTransition({
						issueIdOrKey: project.jiraKey!,
						fields: {
							[config.jira.fields.LQCAssignee]: null,
						},
						transition: {
							id: config.jira.transitions['Assign LQC'],
						},
					});

					const { data: jiraUser } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
						params: { id: discordUser.id },
						auth: {
							username: config.oauthServer.clientId,
							password: config.oauthServer.clientSecret,
						},
					}).catch((err) => {
						logger.info(err.response.data);
						throw new Error(err);
					});

					/* eslint-disable no-param-reassign */
					project.staleCount += 1;
					/* eslint-enable */
					project.save(async (err) => {
						if (err) {
							logger.error(err);
							return;
						}

						await discordUser.send(format(strings.noUpdateInTime, { jiraKey: project.jiraKey! }));
						await jiraClient.issueComments.addComment({
							issueIdOrKey: project.jiraKey!,
							body: `Did not receive an update in time from [~${jiraUser.username}], automatically un-assigning.`,
						});
					});
				}
			}
		}

		if (project.updateRequest & (1 << 2)) {
			const user = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: project.jiraKey,
				assignedAs: 'lqc',
			}).exec();

			if (user && (user.updateRequested! <= compareDate)) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						logger.error(err);
					});

				if (discordUser) {
					await jiraClient.issues.doTransition({
						issueIdOrKey: project.jiraKey!,
						fields: {
							[config.jira.fields.SubQCAssignee]: null,
						},
						transition: {
							id: config.jira.transitions['Assign SubQC'],
						},
					});

					const { data: jiraUser } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
						params: { id: discordUser.id },
						auth: {
							username: config.oauthServer.clientId,
							password: config.oauthServer.clientSecret,
						},
					}).catch((err) => {
						logger.info(err.response.data);
						throw new Error(err);
					});

					/* eslint-disable no-param-reassign */
					project.staleCount += 1;
					/* eslint-enable */
					await project.save(async (err) => {
						if (err) {
							logger.error(err);
							return;
						}

						await discordUser.send(format(strings.noUpdateInTime, { jiraKey: project.jiraKey! }));
						await jiraClient.issueComments.addComment({
							issueIdOrKey: project.jiraKey!,
							body: `Did not receive an update in time from [~${jiraUser.username}], automatically un-assigning.`,
						});
					});
				}
			}
		}
	} else {
		const user = await UserInfo.findOne({
			isAssigned: true,
			assignedTo: project.jiraKey,
		}).exec();

		if (user && (user.updateRequested! <= compareDate)) {
			const discordUser = await client.users.fetch(user._id)
				.catch((err) => {
					logger.error(err);
				});

			if (discordUser) {
				await jiraClient.issues.doTransition({
					issueIdOrKey: project.jiraKey!,
					fields: {
						assignee: null,
					},
					transition: {
						id: config.jira.transitions.Assign,
					},
				});

				const { data: jiraUser } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
					params: { id: discordUser.id },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch((err) => {
					logger.info(err.response.data);
					throw new Error(err);
				});

				/* eslint-disable no-param-reassign */
				project.staleCount += 1;
				/* eslint-enable */
				await project.save(async (err) => {
					if (err) {
						logger.error(err);
						return;
					}

					await discordUser.send(format(strings.noUpdateInTime, { jiraKey: project.jiraKey! }));
					await jiraClient.issueComments.addComment({
						issueIdOrKey: project.jiraKey!,
						body: `Did not receive an update in time from [~${jiraUser.username}], automatically un-assigning.`,
					});
				});
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
			// TODO: Add buttons
			await channel.send(`${project.jiraKey} has not transitioned in three weeks!`);
		}
	}
	await jiraClient.issueComments.addComment({
		issueIdOrKey: project.jiraKey!,
		body: `Project hasn't transitioned in ${'three weeks' /* call humanize-duration instead */}, considering abandoned unless action is taken by team leads.`,
	});

	// eslint-disable-next-line no-param-reassign
	project.abandoned = true;
	await project.save((err) => {
		if (err) logger.error(err);
	});
}

cron.schedule('0 * * * *', async () => {
	const autoAssignAfter = await Setting.findById('autoAssignAfter').lean().exec();

	const toAutoAssign = await IdLink.find({
		$or: [
			{
				status: 'Sub QC/Language QC',
				hasAssignment: { $lt: (1 << 1) + (1 << 2) },
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
		lastUpdate: {
			$lte: new Date(Date.now() - (
				autoAssignAfter?.value ? parseInt(autoAssignAfter.value, 10) : (3 * 24 * 3600 * 1000))),
		},
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

	const requestUpdateAfter = await Setting.findById('requestUpdateAfter').lean().exec();

	const toRequestUpdate = await IdLink.find({
		$or: [
			{
				status: 'Sub QC/Language QC',
				updateRequest: { $lt: (1 << 1) + (1 << 2) },
				$or: [
					{
						sqcLastUpdate: {
							$lte: new Date(Date.now() - (
								// eslint-disable-next-line max-len
								requestUpdateAfter?.value ? parseInt(requestUpdateAfter.value, 10) : (3 * 24 * 3600 * 1000)
							)),
						},
					},
					{
						lqcLastUpdate: {
							$lte: new Date(Date.now() - (
								// eslint-disable-next-line max-len
								requestUpdateAfter?.value ? parseInt(requestUpdateAfter.value, 10) : (3 * 24 * 3600 * 1000)
							)),
						},
					},
				],
			},
			{
				lastUpdate: {
					$lte: new Date(Date.now() - (
						// eslint-disable-next-line max-len
						requestUpdateAfter?.value ? parseInt(requestUpdateAfter.value, 10) : (3 * 24 * 3600 * 1000)
					)),
				},
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
