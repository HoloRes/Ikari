// Imports
import { Router, Request } from 'express';
import {
	BaseGuildTextChannel, Message, MessageActionRow, MessageButton, MessageEmbed, TextChannel,
} from 'discord.js';
import axios from 'axios';
import Sentry from '@sentry/node';
import { Version2Models } from 'jira.js';
import { logger, client, jiraClient } from './index';
import IdLink from './models/IdLink';
import StatusLink from './models/StatusLink';
import UserInfo from './models/UserInfo';
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
	user: Version2Models.DashboardUser;
	issue: Version2Models.Issue;
	changelog: Version2Models.Changelog;
	comment: Version2Models.Comment;
	transition: Version2Models.Transition & { transitionName: string };
}

// Routes
router.post('/webhook', async (req: Request<{}, {}, WebhookBody>, res) => {
	if (req.query.token !== config.webhookSecret) {
		res.status(403).end();
		return;
	}
	res.status(200).end();

	if (req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') {
		logger.verbose('New Jira issue webhook triggered');

		let encounteredError = false;
		const channelLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while finding channel link (${eventId})`);
				logger.error(err);
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!channelLink) {
			logger.warn(`No channel link for ${req.body.issue.fields!.status.name} found!`);
			return;
		}

		const channel = await client.channels.fetch(channelLink.channel)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while finding Discord channel (${eventId})`);
				logger.error(err);
				encounteredError = true;
			}) as unknown as BaseGuildTextChannel | null;
		if (encounteredError) return;

		if (channel?.type !== 'GUILD_TEXT') {
			logger.error(`Channel: ${channelLink.channel} is not a guild text channel`);
			return;
		}

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
			.addField('Status', req.body.issue.fields!.status.name!)
			.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
			.setFooter({ text: `Due date: ${req.body.issue.fields!.duedate || 'unknown'}` })
			.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

		const msg = await channel.send({ content: 'A new project is available and can be picked up in Jira', embeds: [embed] })
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while sending message (${eventId})`);
				logger.error(err);
				encounteredError = true;
			});
		if (encounteredError) return;

		link.discordMessageId = msg!.id;
		link.save((err) => {
			if (err) {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while saving issue link (${eventId})`);
				logger.error(err);
			}
		});
	} else {
		let encounteredError = false;
		// Get the project from the db
		const link = await IdLink.findOne({ jiraKey: req.body.issue.key })
			.exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while finding issue link (${eventId})`);
				logger.error(err);
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!link) {
			// eslint-disable-next-line max-len
			// TODO: For prod, create a link if it doesn't exist, expect Ikari to be offline/crashed in those cases.
			return;
		}

		if (link.finished || link.abandoned) return;

		const statusLink = await StatusLink.findById(link.status).lean().exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while finding status link (${eventId})`);
				logger.error(err);
				encounteredError = true;
			});
		if (encounteredError) return;

		const transitionName = req.body.transition?.transitionName;

		if (req.body.issue.fields!.status.name === 'Open') {
			if (link.discordMessageId && statusLink) {
				const channel = await client.channels.fetch(statusLink.channel)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while finding discord channel (${eventId})`);
						logger.error(err);
						encounteredError = true;
					}) as unknown as BaseGuildTextChannel | null;
				if (encounteredError) return;

				if (channel?.type !== 'GUILD_TEXT') {
					logger.error(`Channel: ${statusLink.channel} is not a guild text channel`);
					return;
				}

				const msg = await channel.messages.fetch(link.discordMessageId)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching message (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
				if (encounteredError) return;

				await msg!.delete()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while deleting message (${eventId})`);
						logger.error(err);
					});
			} else if (link.discordMessageId) {
				// eslint-disable-next-line max-len
				const channelLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching channel link (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!channelLink) {
					logger.warn(`No channel link for ${req.body.issue.fields!.status.name} found!`);
					return;
				}

				const channel = await client.channels.fetch(channelLink.channel)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while finding discord channel (${eventId})`);
						logger.error(err);
						encounteredError = true;
					}) as unknown as BaseGuildTextChannel | null;
				if (encounteredError) return;

				if (channel?.type !== 'GUILD_TEXT') {
					logger.error(`Channel: ${channelLink.channel} is not a guild text channel`);
					return;
				}

				const msg = await channel.messages.fetch(link.discordMessageId)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching message (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
				if (!msg) return;
				await msg.delete()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while deleting message (${eventId})`);
						logger.error(err);
					});
				return;
			}

			// eslint-disable-next-line max-len
			const channelLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching channel link (${eventId})`);
					logger.error(err);
					encounteredError = true;
				});
			if (encounteredError) return;

			if (!channelLink) {
				logger.warn(`No channel link for ${req.body.issue.fields!.status.name} found!`);
				return;
			}

			const channel = await client.channels.fetch(channelLink.channel)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while finding discord channel (${eventId})`);
					logger.error(err);
					encounteredError = true;
				}) as unknown as BaseGuildTextChannel | null;
			if (encounteredError) return;

			if (channel?.type !== 'GUILD_TEXT') {
				logger.error(`Channel: ${channelLink.channel} is not a guild text channel`);
				return;
			}

			const embed = new MessageEmbed()
				.setTitle(`${req.body.issue.key}`)
				.setColor('#0052cc')
				.setDescription(req.body.issue.fields!.summary ?? 'No description available')
				.addField('Status', req.body.issue.fields!.status.name)
				.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
				.setFooter({ text: `Due date: ${req.body.issue.fields!.duedate || 'unknown'}` })
				.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

			const msg = await channel.send({ content: 'A new project is available and can be picked up in Jira', embeds: [embed] })
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while sending message (${eventId})`);
					logger.error(err);
					encounteredError = true;
				});
			if (encounteredError) return;

			link.discordMessageId = msg!.id;
			link.status = req.body.issue.fields!.status.name;
			link.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving issue link (${eventId})`);
					logger.error(err);
				}
			});
			return;
		}

		if (transitionName === 'Uploaded' || transitionName === 'Abandon project') {
			if (statusLink && link.discordMessageId) {
				const channel = await client.channels.fetch(statusLink.channel)
					.catch((err) => {
						throw new Error(err);
					}) as unknown as BaseGuildTextChannel | null;

				if (channel?.type !== 'GUILD_TEXT') {
					logger.error(`Channel: ${statusLink.channel} is not a guild text channel`);
					return;
				}

				const msg = await channel.messages.fetch(link.discordMessageId)
					.catch((err) => {
						throw new Error(err);
					});
				await msg.delete();
			}
			if (transitionName === 'Uploaded') link.finished = true;
			if (transitionName === 'Abandon project') link.abandoned = true;
			link.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving issue link (${eventId})`);
					logger.error(err);
				}
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
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while transitioning issue ${req.body.issue.key!} (${eventId})`);
				encounteredError = true;
			});
			if (encounteredError) return;

			const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
				params: { key: req.body.user.key },
				auth: {
					username: config.oauthServer.clientId,
					password: config.oauthServer.clientSecret,
				},
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
				encounteredError = true;
			});
			if (encounteredError) return;
			const user = oauthUserRes!.data;

			const discordUser = await client.users.fetch(user._id)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching Discord user (${eventId})`);
					logger.error(err);
					encounteredError = true;
				});
			if (encounteredError) return;

			discordUser!.send(strings.IkariClippingNotAvailable)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while sending message to Discord user (${eventId})`);
					logger.error(err);
				});
			return;
		}

		// If the status doesn't have a Discord channel linked to it or the project has no message
		if (!statusLink || !link.discordMessageId) {
			logger.verbose(`No link found for: ${link.status}`);
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

				// Un-assign all users who were assigned in the previous status
				const assignedUsers = await UserInfo.find({ assignedTo: req.body.issue.key }).exec();
				assignedUsers.forEach((user) => {
					/* eslint-disable no-param-reassign */
					user.isAssigned = false;
					user.lastAssigned = new Date();
					user.assignedAs = undefined;
					user.assignedTo = undefined;
					user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user document (${eventId})`);
							logger.error(err);
						}
					});
					/* eslint-enable */
				});

				// If the new status is uploaded, we only need to update the document in the db
				if (req.body.issue.fields!.status.name === 'Uploaded') {
					link.discordMessageId = undefined;
					link.status = req.body.issue.fields!.status.name;
					link.lastUpdate = new Date();
					link.hasAssignment = 0;
					link.finished = true;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error(err);
						}
					});
					return;
				}

				// eslint-disable-next-line max-len
				const newStatusLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching status link (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!newStatusLink) {
					logger.warn(`No channel link found for: ${req.body.issue.fields!.status.name!}`);
					link.discordMessageId = undefined;
					link.status = req.body.issue.fields!.status.name!;
					link.lastUpdate = new Date();
					link.hasAssignment = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error(err);
						}
					});
					return;
				}

				const newChannel = await client.channels.fetch(newStatusLink.channel)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching Discord channel (${eventId})`);
						logger.error(err);
						encounteredError = true;
					}) as unknown as BaseGuildTextChannel | null;
				if (encounteredError) return;

				if (newChannel?.type !== 'GUILD_TEXT') {
					logger.error(`Channel: ${newStatusLink.channel} is not a guild text channel`);
					return;
				}

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
						.setFooter({ text: `Due date: ${req.body.issue.fields!.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: [newRow],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
					if (encounteredError) return;

					link.discordMessageId = newMsg!.id;
					link.status = req.body.issue.fields!.status.name;
					link.lastUpdate = new Date();
					link.lqcProgressStart = undefined;
					link.sqcProgressStart = undefined;
					link.hasAssignment = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error(err);
						}
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
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
					if (encounteredError) return;

					link.discordMessageId = newMsg!.id;
					link.status = req.body.issue.fields!.status.name;
					link.lastUpdate = new Date();
					link.hasAssignment = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error(err);
						}
					});
				} else {
					let user: any | undefined;
					if (req.body.issue.fields!.assignee !== null) {
						const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
							params: { key: req.body.issue.fields!.assignee.key },
							auth: {
								username: config.oauthServer.clientId,
								password: config.oauthServer.clientSecret,
							},
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
							encounteredError = true;
						});
						if (encounteredError) return;

						user = oauthUserRes!.data;
						link.hasAssignment = (1 << 0);
					} else {
						link.hasAssignment = 0;
					}

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
						.addField('Status', req.body.issue.fields!.status.name!)
						.addField('Assignee', user ? `<@${user._id}>` : 'Unassigned')
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields!.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error(err);
					});

					link.discordMessageId = newMsg?.id ?? undefined;
					link.status = req.body.issue.fields!.status.name!;
					link.lastUpdate = new Date();

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error(err);
						}
					});
				}
			}
			return;
		}

		const channel = await client.channels.fetch(statusLink.channel)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching Discord channel (${eventId})`);
				logger.error(err);
				encounteredError = true;
			}) as TextChannel | null;
		if (encounteredError) return;

		if (channel?.type !== 'GUILD_TEXT') {
			logger.error(`Channel: ${statusLink.channel} is not a guild text channel`);
			return;
		}

		const msg = await channel.messages.fetch(link.discordMessageId!)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching message (${eventId})`);
				logger.error(err);
				encounteredError = true;
			}) as Message;
		if (encounteredError || !msg) return;

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
			link.progressStart = undefined;

			if (req.body.issue.fields!.assignee === null) {
				if (link.hasAssignment & (1 << 0)) {
					link.hasAssignment -= (1 << 0);

					if (link.inProgress & (1 << 0)) {
						link.inProgress -= (1 << 0);
					}

					const user = await UserInfo.findOne({ assignedTo: link.jiraKey }).exec()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while fetching user from db (${eventId})`);
							logger.error(err);
							encounteredError = true;
						});
					if (encounteredError || !user) return;

					user.isAssigned = false;
					user.assignedAs = undefined;
					user.assignedTo = undefined;
					user.lastAssigned = new Date();

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error(err);
						}
					});

					user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user in db (${eventId})`);
							logger.error(err);
						}
					});
				}

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: 'Unassigned',
				} as any);

				const status = req.body.issue.fields!.status.name;

				await msg.edit({
					embeds: [embed],
					components: (status === 'Open' || status === 'Rejected' || status === 'Being clipped' || status === 'Uploaded') ? [] : [row],
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while editing message in Discord user (${eventId})`);
					logger.error(err);
				});
			} else {
				const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields!.assignee.key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
					encounteredError = true;
				});
				if (encounteredError) return;
				const user = oauthUserRes!.data;

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
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving user in db (${eventId})`);
							logger.error(err);
						}
					});
				}

				if (link.inProgress & (1 << 0)) {
					link.inProgress -= (1 << 0);
				}
				if (!(link.hasAssignment & (1 << 0))) {
					link.hasAssignment += (1 << 0);
				}

				let userDoc = await UserInfo.findById(user._id).exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error finding user in db (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}
				userDoc.isAssigned = true;
				userDoc.lastAssigned = new Date();
				userDoc.assignedTo = req.body.issue.key;
				userDoc.updateRequested = new Date();
				userDoc.updateRequestCount = 0;

				link.lastUpdate = new Date();

				userDoc.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error saving user in db (${eventId})`);
						logger.error(err);
					}
				});
				link.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error saving issue link (${eventId})`);
						logger.error(err);
					}
				});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: `<@${user._id}>`,
				} as any);

				msg.edit({
					embeds: [embed],
					components: [row],
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while editing message in Discord user (${eventId})`);
					logger.error(err);
				});

				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching Discord user (${eventId})`);
						logger.error(err);
					});
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
			link.lqcProgressStart = undefined;

			if (req.body.issue.fields![config.jira.fields.LQCAssignee] === null) {
				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'LQC Assignee',
					value: 'Unassigned',
					inline: true,
				} as any);
				await msg.edit({
					embeds: [embed],
					components: [row],
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while editing message in Discord user (${eventId})`);
					logger.error(err);
				});

				if (link.hasAssignment & (1 << 1)) {
					link.hasAssignment -= (1 << 1);

					if (link.inProgress & (1 << 1)) {
						link.inProgress -= (1 << 1);
					}

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error(err);
						}
					});

					const user = await UserInfo.findOne({ assignedTo: link.jiraKey, assignedAs: 'lqc' }).exec()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error finding user in db (${eventId})`);
							logger.error(err);
							encounteredError = true;
						});

					if (encounteredError || !user) return;
					user.isAssigned = false;
					user.assignedAs = undefined;
					user.assignedTo = undefined;
					user.lastAssigned = new Date();

					user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving user in db (${eventId})`);
							logger.error(err);
						}
					});
				}
			} else {
				const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields!.assignee.key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
					encounteredError = true;
				});
				if (encounteredError) return;
				const user = oauthUserRes!.data;

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
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user in db (${eventId})`);
							logger.error(err);
						}
					});
				}

				if (link.inProgress & (1 << 1)) {
					link.inProgress -= (1 << 1);
				}
				if (!(link.hasAssignment & (1 << 1))) {
					link.hasAssignment += (1 << 1);
				}

				link.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving issue link (${eventId})`);
						logger.error(err);
					}
				});

				let userDoc = await UserInfo.findById(user._id).exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching user from db (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
				if (encounteredError) return;
				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}
				userDoc.isAssigned = true;
				userDoc.lastAssigned = new Date();
				userDoc.assignedTo = req.body.issue.key;
				userDoc.assignedAs = 'lqc';
				userDoc.updateRequested = new Date();
				userDoc.updateRequestCount = 0;

				userDoc.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving user in db (${eventId})`);
						logger.error(err);
					}
				});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'LQC Assignee',
					value: `<@${user._id}>`,
					inline: true,
				} as any);

				await msg.edit({
					embeds: [embed],
					components: [row],
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while editing message in Discord user (${eventId})`);
					logger.error(err);
				});

				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching user on Discord (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
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

			link.sqcProgressStart = undefined;

			if (req.body.issue.fields![config.jira.fields.SubQCAssignee] === null) {
				const embed = msg.embeds[0].spliceFields(2, 1, {
					name: 'SubQC Assignee',
					value: 'Unassigned',
					inline: true,
				} as any);

				await msg.edit({
					embeds: [embed],
					components: [row],
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while editing message in Discord user (${eventId})`);
					logger.error(err);
				});

				if (link.hasAssignment & (1 << 2)) {
					link.hasAssignment -= (1 << 2);

					if (link.inProgress & (1 << 2)) {
						link.inProgress -= (1 << 2);
					}
					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error(err);
						}
					});

					const user = await UserInfo.findOne({ assignedTo: link.jiraKey, assignedAs: 'sqc' }).exec()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error finding user in db (${eventId})`);
							logger.error(err);
							encounteredError = true;
						});

					if (encounteredError || !user) return;
					user.isAssigned = false;
					user.assignedAs = undefined;
					user.assignedTo = undefined;
					user.lastAssigned = new Date();

					user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving user in db (${eventId})`);
							logger.error(err);
						}
					});
				}
			} else {
				const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields![config.jira.fields.SubQCAssignee].key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
					encounteredError = true;
				});
				if (encounteredError) return;
				const user = oauthUserRes!.data;

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
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user in db (${eventId})`);
							logger.error(err);
						}
					});
				}

				if (link.inProgress & (1 << 2)) {
					link.inProgress -= (1 << 2);
				}
				if (!(link.hasAssignment & (1 << 2))) {
					link.hasAssignment += (1 << 2);
				}

				link.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving issue link (${eventId})`);
						logger.error(err);
					}
				});

				let userDoc = await UserInfo.findById(user._id).exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching user from db (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}
				userDoc.isAssigned = true;
				userDoc.lastAssigned = new Date();
				userDoc.assignedTo = req.body.issue.key;
				userDoc.assignedAs = 'sqc';
				userDoc.updateRequested = new Date();
				userDoc.updateRequestCount = 0;

				userDoc.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving user in db (${eventId})`);
						logger.error(err);
					}
				});

				const embed = msg.embeds[0].spliceFields(2, 1, {
					name: 'SubQC Assignee',
					value: `<@${user._id}>`,
					inline: true,
				} as any);

				await msg.edit({
					embeds: [embed],
					components: [row],
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while editing message in Discord user (${eventId})`);
					logger.error(err);
				});

				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching user on Discord (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
			}
		} else {
			// eslint-disable-next-line max-len
			link.languages = req.body.issue.fields![config.jira.fields.langs].map((language: JiraField) => language.value);
			link.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving issue link (${eventId})`);
					logger.error(err);
				}
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
						.setFooter({ text: `Due date: ${req.body.issue.fields!.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					await msg.edit({
						embeds: [embed],
						components: [newRow],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while editing message in Discord user (${eventId})`);
						logger.error(err);
					});
				} else {
					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
						.addField('Status', req.body.issue.fields!.status.name)
						.addField('Assignee', msg.embeds[0].fields[1].value)
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields!.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					await msg.edit({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while editing message in Discord user (${eventId})`);
						logger.error(err);
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
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user in db (${eventId})`);
							logger.error(err);
						}
					});
					/* eslint-enable */
				});

				// eslint-disable-next-line max-len
				const newStatusLink = await StatusLink.findById(req.body.issue.fields!.status.name).lean().exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching status link (${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!newStatusLink) {
					logger.warn(`No channel link found for: ${req.body.issue.fields!.status.name}`);
					link.discordMessageId = undefined;
					link.status = req.body.issue.fields!.status.name!;
					link.lastUpdate = new Date();
					link.hasAssignment = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error(err);
						}
					});
					return;
				}

				const newChannel = await client.channels.fetch(newStatusLink.channel)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching Discord channel (${eventId})`);
						logger.error(err);
						encounteredError = true;
					}) as TextChannel | null;
				if (encounteredError) return;

				if (newChannel?.type !== 'GUILD_TEXT') {
					logger.error(`Channel: ${newStatusLink.channel} is not a guild text channel`);
					return;
				}

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
						.setFooter({ text: `Due date: ${req.body.issue.fields!.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: [newRow],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error(err);
					});

					link.discordMessageId = newMsg?.id ?? undefined;
					link.status = req.body.issue.fields!.status.name;
					link.lastUpdate = new Date();
					link.progressStart = undefined;
					link.lqcProgressStart = undefined;
					link.sqcProgressStart = undefined;
					link.hasAssignment = 0;
					link.inProgress = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error(err);
						}
					});

					await msg.delete()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while deleting message (${eventId})`);
							logger.error(err);
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
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error(err);
					});

					link.discordMessageId = newMsg?.id ?? undefined;
					link.status = req.body.issue.fields!.status.name;
					link.lastUpdate = new Date();
					link.hasAssignment = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error(err);
						}
					});

					await msg.delete()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while deleting message (${eventId})`);
							logger.error(err);
						});
				} else {
					let user: any | undefined;
					if (req.body.issue.fields!.assignee !== null) {
						link.hasAssignment = (1 << 0);

						const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
							params: { key: req.body.issue.fields!.assignee.key },
							auth: {
								username: config.oauthServer.clientId,
								password: config.oauthServer.clientSecret,
							},
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
							encounteredError = true;
						});
						if (!encounteredError) user = oauthUserRes!.data;
					} else {
						link.hasAssignment = 0;
					}

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields!.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields!.description ?? 'No description available')
						.addField('Status', req.body.issue.fields!.status.name!)
						.addField('Assignee', user ? `<@${user._id}>` : 'Unassigned')
						.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields!.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message to Discord user (${eventId})`);
						logger.error(err);
					});

					link.discordMessageId = newMsg?.id ?? undefined;
					link.status = req.body.issue.fields!.status.name!;
					link.lastUpdate = new Date();

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error(err);
						}
					});

					await msg.delete()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while deleting message (${eventId})`);
							logger.error(err);
						});
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
