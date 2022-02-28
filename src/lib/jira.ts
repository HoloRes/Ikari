// Imports
import { Router, Request } from 'express';
import {
	Message, MessageActionRow, MessageButton, MessageEmbed, TextChannel,
} from 'discord.js';
import axios from 'axios';
import * as Sentry from '@sentry/node';
import { Version2Models } from 'jira.js';
import { Document } from 'mongoose';
import { createClient as createWebdavClient, FileStat } from 'webdav';
import format from 'string-template';
import { logger, client, jiraClient } from '../index';
import IdLink, { Project } from '../models/IdLink';
import StatusLink from '../models/StatusLink';
import UserInfo from '../models/UserInfo';
import sendUserAssignedEmbed from './sendUserAssignedEmbed';
import { allServicesOnline } from './middleware';

// Local files
const config = require('../../config.json');
const strings = require('../../strings.json');

// Init
// eslint-disable-next-line import/prefer-default-export
export const router = Router();

const webdavClient = createWebdavClient(
	config.webdav.url,
	{
		username: config.webdav.username,
		password: config.webdav.password,
		maxBodyLength: 100000000,
		maxContentLength: 100000000,
	},
);

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

		// Search Discord channel in DB
		logger.debug(`Searching channel for ${req.body.issue.fields.status.name}`);
		let encounteredError = false;
		const channelLink = await StatusLink.findById(req.body.issue.fields.status.name).lean().exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while finding channel link (${eventId})`);
				logger.error('%o', err);
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!channelLink) {
			logger.warn(`No channel link for ${req.body.issue.fields.status.name} found!`);
			return;
		}
		logger.debug(`Found channel for ${req.body.issue.fields.status.name}: %o`, channelLink);

		// Fetch channel on Discord
		logger.debug(`Fetching Discord channel: ${channelLink.channel}`);
		const channel = await client.channels.fetch(channelLink.channel)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while finding Discord channel (${eventId})`);
				logger.error('%o', err);
				encounteredError = true;
			}) as TextChannel;
		if (encounteredError) return;

		if (channel?.type !== 'GUILD_TEXT') {
			logger.error(`Channel: ${channelLink.channel} is not a guild text channel`);
			return;
		}

		// Create new project in DB
		const link = new IdLink({
			jiraKey: req.body.issue.key,
			type: 'translation',
			status: req.body.issue.fields.status.name,
			// eslint-disable-next-line max-len
			languages: req.body.issue.fields[config.jira.fields.langs].map((language: JiraField) => language.value),
			lastUpdate: new Date(),
			lastStatusChange: new Date(),
		});

		// Create embed and send in Discord
		const embed = new MessageEmbed()
			.setTitle(req.body.issue.key)
			.setColor('#0052cc')
			.setDescription(req.body.issue.fields.summary ?? 'No description available')
			.addField('Status', req.body.issue.fields.status.name!)
			.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
			.setFooter({ text: `Due date: ${req.body.issue.fields.duedate ?? 'unknown'}` })
			.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

		logger.debug(`Sending created embed for: ${req.body.issue.key}`);
		const msg = await channel.send({ content: 'A new project is available and can be picked up in Jira', embeds: [embed] })
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while sending message (${eventId})`);
				logger.error('%o', err);
				encounteredError = true;
			});
		if (encounteredError) return;

		link.discordMessageId = msg?.id;

		logger.debug(`Saving project ${req.body.issue.key} in db: %o`, link);
		link.save((err) => {
			if (err) {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while saving issue link (${eventId})`);
				logger.error('%o', err);
			}
		});
	} else {
		let encounteredError = false;
		// Get the project from the db
		logger.debug(`Getting project from db for ${req.body.issue.key}`);
		let link = await IdLink.findOne({ jiraKey: req.body.issue.key })
			.exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while finding issue link (${eventId})`);
				logger.error('%o', err);
				encounteredError = true;
				/*
				  Yes, this can be void, but we solve that with the below if statement.
				  This type conversion is only here to prevent TS errors for
				  this possibly being undefined, while it isn't
				*/
			}) as Document<any, any, Project> & Project;
		if (encounteredError) return;

		// Create project in db if there isn't one for some reason
		if (!link) {
			logger.debug(`No link for ${req.body.issue.key}, creating one`);
			// eslint-disable-next-line max-len
			link = new IdLink({
				jiraKey: req.body.issue.key,
				type: 'translation',
				status: req.body.issue.fields.status.name,
				// eslint-disable-next-line max-len
				languages: req.body.issue.fields[config.jira.fields.langs].map((language: JiraField) => language.value),
				lastUpdate: new Date(),
				lastStatusChange: new Date(),
			});
		}

		// Unmute project
		link.mutedUntil = undefined;

		if (link.finished || link.abandoned) return;

		// Getting Discord channel id from db for current status
		logger.debug(`Getting channel from db for: ${link.status}`);
		const statusLink = await StatusLink.findById(link.status).lean().exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while finding status link (${eventId})`);
				logger.error('%o', err);
				encounteredError = true;
			});
		if (encounteredError) return;

		const transitionName = req.body.transition?.transitionName;
		logger.debug(`New status of ${req.body.issue.key}: ${req.body.issue.fields.status.name}`);

		// Seems to delete and post the message again,
		//  instead of editing and replacing the embed? Should be updated sometime
		if (req.body.issue.fields.status.name === 'Open') {
			if (link.discordMessageId && statusLink) {
				// Fetch channel from Discord to fetch previous message and delete it
				logger.debug(`Fetching channel from Discord: ${statusLink.channel}`);
				const channel = await client.channels.fetch(statusLink.channel)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while finding discord channel (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					}) as TextChannel;
				if (encounteredError) return;

				if (channel?.type !== 'GUILD_TEXT') {
					logger.error(`Channel: ${statusLink.channel} is not a guild text channel`);
					return;
				}

				logger.debug(`Fetching message from Discord in channel ${channel.id} (${channel.name}): ${link.discordMessageId}`);
				const msg = await channel.messages.fetch(link.discordMessageId)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching message (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (msg) logger.debug(`Deleting Discord message: ${msg.id} in ${channel.id}`);
				await msg?.delete()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while deleting message (${eventId})`);
						logger.error('%o', err);
					});
			} else if (link.discordMessageId) {
				logger.debug(`Fetching Discord channel id from db for: ${req.body.issue.fields.status.name}`);
				// eslint-disable-next-line max-len
				const channelLink = await StatusLink.findById(req.body.issue.fields.status.name).lean().exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching channel link (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!channelLink) {
					logger.warn(`No channel link for ${req.body.issue.fields.status.name} found!`);
					return;
				}

				logger.debug(`Fetching channel on Discord: ${channelLink.channel}`);
				const channel = await client.channels.fetch(channelLink.channel)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while finding discord channel (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					}) as TextChannel;
				if (encounteredError) return;

				if (channel?.type !== 'GUILD_TEXT') {
					logger.error(`Channel: ${channelLink.channel} is not a guild text channel`);
					return;
				}

				logger.debug(`Fetching message from Discord in channel ${channel.id} (${channel.name}): ${link.discordMessageId}`);
				const msg = await channel.messages.fetch(link.discordMessageId)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching message (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});

				if (msg) logger.debug(`Deleting Discord message: ${msg.id} in ${channel.id}`);
				await msg?.delete()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while deleting message (${eventId})`);
						logger.error('%o', err);
					});
			}

			// eslint-disable-next-line max-len
			logger.debug(`Fetching Discord channel id from db for: ${req.body.issue.fields.status.name}`);
			const channelLink = await StatusLink.findById(req.body.issue.fields.status.name).lean().exec()
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching channel link (${eventId})`);
					logger.error('%o', err);
					encounteredError = true;
				});
			if (encounteredError) return;

			if (!channelLink) {
				logger.warn(`No channel link for ${req.body.issue.fields.status.name} found!`);
				return;
			}

			logger.debug(`Fetching channel on Discord: ${channelLink.channel}`);
			const channel = await client.channels.fetch(channelLink.channel)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while finding discord channel (${eventId})`);
					logger.error('%o', err);
					encounteredError = true;
				}) as TextChannel;
			if (encounteredError) return;

			if (channel?.type !== 'GUILD_TEXT') {
				logger.error(`Channel: ${channelLink.channel} is not a guild text channel`);
				return;
			}

			// Create an embed and send in Discord
			const embed = new MessageEmbed()
				.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
				.setColor('#0052cc')
				.setDescription(req.body.issue.fields.summary ?? 'No description available')
				.addField('Status', req.body.issue.fields.status.name)
				.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
				.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
				.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

			logger.debug(`Sending created embed for: ${req.body.issue.key}`);
			const msg = await channel.send({ content: 'A new project is available and can be picked up in Jira', embeds: [embed] })
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while sending message (${eventId})`);
					logger.error('%o', err);
					encounteredError = true;
				});
			if (encounteredError) return;

			link.discordMessageId = msg?.id;
			link.status = req.body.issue.fields.status.name;

			logger.debug(`Saving project ${req.body.issue.key} in db: %o`, link);
			link.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving issue link (${eventId})`);
					logger.error('%o', err);
				}
			});
			return;
		}

		// When a project is finished or abandoned
		if (transitionName === 'Uploaded' || transitionName === 'Abandon project') {
			if (statusLink && link.discordMessageId) {
				logger.debug(`Fetching channel on Discord: ${statusLink.channel}`);
				const channel = await client.channels.fetch(statusLink.channel)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching Discord channel (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					}) as TextChannel;
				if (encounteredError) return;

				if (channel?.type !== 'GUILD_TEXT') {
					logger.error(`Channel: ${statusLink.channel} is not a guild text channel`);
				} else {
					logger.debug(`Fetching message from ${channel.name} (${statusLink.channel}): ${link.discordMessageId}`);
					const msg = await channel.messages.fetch(link.discordMessageId)
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while fetching Discord channel (${eventId})`);
							logger.error('%o', err);
						});

					logger.debug(`Trying to delete message from Discord channel: ${link.discordMessageId}`);
					await msg?.delete()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while deleting message (${eventId})`);
							logger.error('%o', err);
						});
				}
			}

			if (link.hasAssignment > 0) {
				logger.debug(`Fetching all assigned users to ${req.body.issue.key}`);
				const previousAssignedUsers = await UserInfo.find({
					assignedTo: req.body.issue.key,
				}).exec().catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from db (${eventId})`);
				});

				logger.debug(`All assigned users to ${req.body.issue.key}: %o`, previousAssignedUsers ?? []);

				previousAssignedUsers?.forEach((previousAssignedUser) => {
					// Remove all references to the issue
					/* eslint-disable no-param-reassign */
					previousAssignedUser.assignedAs.delete(req.body.issue.key);
					previousAssignedUser.updateRequested.delete(req.body.issue.key);
					previousAssignedUser.updateRequestCount.delete(req.body.issue.key);

					const newAssignedTo = [...previousAssignedUser.assignedTo];
					// eslint-disable-next-line max-len
					newAssignedTo.splice(previousAssignedUser.assignedTo.findIndex((el) => el === req.body.issue.key), 1);

					previousAssignedUser.assignedTo = newAssignedTo;
					previousAssignedUser.lastAssigned = new Date();
					/* eslint-enable */

					logger.debug(`Saving user ${previousAssignedUser._id} in db: %o`, previousAssignedUser);
					previousAssignedUser.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving user in db (${eventId})`);
							logger.error('%o', err);
						}
					});
				});
			}

			if (transitionName === 'Uploaded') link.finished = true;
			if (transitionName === 'Abandon project') {
				// Abandon all linked (artist) issues, if there are any
				const issue = await jiraClient.issues.getIssue({ issueIdOrKey: req.body.issue.key, fields: ['issuelinks'] })
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching issue on Jira (${eventId})`);
					});
				if (issue) {
					const links = issue.fields.issuelinks;
					links.forEach((linkedIssueBare) => {
						if (linkedIssueBare.inwardIssue?.key) {
							jiraClient.issues.getIssue({ issueIdOrKey: linkedIssueBare.inwardIssue?.key, fields: ['project'] })
								.then(async (linkedIssue) => {
									if (linkedIssue.fields.project.key === 'ARTIST') {
										await jiraClient.issues.doTransition({
											issueIdOrKey: linkedIssue.key,
											transition: {
												id: config.jira.artist.transitions['Abandon project'],
											},
										}).catch((err) => {
											const eventId = Sentry.captureException(err);
											logger.error(`Encountered error transitioning issue (${eventId})`);
										});
									}
								})
								.catch((err) => {
									const eventId = Sentry.captureException(err);
									logger.error(`Encountered error while fetching issue on Jira (${eventId})`);
								});
						}
					});
				}

				link.abandoned = true;
			}

			link.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving issue link (${eventId})`);
					logger.error('%o', err);
				}
			});
			return;
		}

		if (transitionName === 'Send to Ikari') {
			logger.verbose(`Creating project folder for ${req.body.issue.key}`);
			const folderName = `${req.body.issue.key} - ${req.body.issue.fields.summary}`;
			const folderPath = `/TL/Projects/${folderName}/`;

			try {
				if (!await webdavClient.exists(folderPath)) {
					await webdavClient.createDirectory(folderPath);
					// eslint-disable-next-line max-len
					const files = await webdavClient.getDirectoryContents('/TL/Project template', { deep: true }) as FileStat[];
					files.forEach((item) => {
						if (item.type === 'directory') {
							webdavClient.createDirectory(item.filename);
						} else if (item.type === 'file') {
							webdavClient.copyFile(item.filename, `${folderPath}${format(item.basename, {
								projectKey: req.body.issue.key,
								projectName: req.body.issue.fields.summary,
							})}`);
						}
					});
				}
			} catch (err) {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while copying files on Nextcloud (${eventId})`);
			}

			// Immediately transition, since Ikari's clipping is not available yet.
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

			// Send a notice to the person who transitioned
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
					logger.error('%o', err);
					encounteredError = true;
				});
			if (encounteredError) return;

			discordUser!.send(strings.IkariClippingNotAvailable)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while sending message to Discord user (${eventId})`);
					logger.error('%o', err);
				});
			return;
		}

		// If the status doesn't have a Discord channel linked to it
		if (!statusLink) {
			logger.verbose(`No link found for: ${link.status}`);
			// Only do something with the project if there's a status change
			if (req.body.issue.fields.status.name !== link.status) {
				logger.verbose('Project status changed, so posting new message');
				const row = new MessageActionRow()
					.addComponents(
						new MessageButton()
							.setCustomId(`assignToMe:${req.body.issue.key}`)
							.setLabel('Assign to me')
							.setStyle('SUCCESS')
							.setEmoji('819518919739965490')
							.setDisabled(req.body.issue.fields.assignee !== null),
					);

				// Un-assign all users who were assigned in the previous status
				const assignedUsers = await UserInfo.find({ assignedTo: req.body.issue.key }).exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching users from db (${eventId})`);
					});

				assignedUsers?.forEach((user) => {
					/* eslint-disable no-param-reassign */
					user.assignedAs.delete(req.body.issue.key);
					user.updateRequested.delete(req.body.issue.key);
					user.updateRequestCount.delete(req.body.issue.key);
					const newAssignedTo = [...user.assignedTo];
					// eslint-disable-next-line max-len
					newAssignedTo.splice(user.assignedTo.findIndex((el) => el === req.body.issue.key), 1);
					user.assignedTo = newAssignedTo;
					user.lastAssigned = new Date();
					/* eslint-enable */

					user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user document (${eventId})`);
							logger.error('%o', err);
						}
					});
				});

				// If the new status is uploaded, we only need to update the document in the db
				if (req.body.issue.fields.status.name === 'Uploaded') {
					link.discordMessageId = undefined;
					link.status = req.body.issue.fields.status.name;
					link.lastUpdate = new Date();
					link.hasAssignment = 0;
					link.finished = true;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
					return;
				}

				// eslint-disable-next-line max-len
				const newStatusLink = await StatusLink.findById(req.body.issue.fields.status.name).lean().exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching status link (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!newStatusLink) {
					logger.warn(`No channel link found for: ${req.body.issue.fields.status.name!}`);
					link.discordMessageId = undefined;
					link.status = req.body.issue.fields.status.name!;
					link.lastUpdate = new Date();
					link.hasAssignment = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
					return;
				}

				const newChannel = await client.channels.fetch(newStatusLink.channel)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching Discord channel (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					}) as TextChannel;
				if (encounteredError) return;

				if (newChannel?.type !== 'GUILD_TEXT') {
					logger.error(`Channel: ${newStatusLink.channel} is not a guild text channel`);
					return;
				}

				if (req.body.issue.fields.status.name === 'Sub QC/Language QC') {
					const newRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
								.setLabel('Assign LQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields[config.jira.fields.LQCAssignee] !== null),
						).addComponents(
							new MessageButton()
								.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
								.setLabel('Assign SQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields[config.jira.fields.SQCAssignee] !== null),
						);

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name)
						.addField('LQC Assignee', 'Unassigned', true)
						.addField('SQC Assignee', 'Unassigned', true)
						.addField('LQC Status', 'To do')
						.addField('SQC Status', 'To do')
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: [newRow],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});
					if (encounteredError) return;

					link.discordMessageId = newMsg?.id;
					link.status = req.body.issue.fields.status.name;
					link.lastUpdate = new Date();
					link.lqcProgressStart = undefined;
					link.sqcProgressStart = undefined;
					link.hasAssignment = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
				} else if (req.body.issue.fields.status.name === 'Ready for release') {
					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name)
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						content: 'New project ready for release',
						embeds: [embed],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});
					if (encounteredError) return;

					link.discordMessageId = newMsg?.id;
					link.status = req.body.issue.fields.status.name;
					link.lastUpdate = new Date();
					link.hasAssignment = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
				} else {
					let user: any | undefined;
					if (req.body.issue.fields.assignee !== null) {
						const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
							params: { key: req.body.issue.fields.assignee.key },
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
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name!)
						.addField('Assignee', user ? `<@${user._id}>` : 'Unassigned')
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
					});

					link.discordMessageId = newMsg?.id;
					link.status = req.body.issue.fields.status.name!;
					link.lastUpdate = new Date();

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error('%o', err);
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
				logger.error('%o', err);
				encounteredError = true;
			}) as TextChannel | null;
		if (encounteredError) return;

		if (channel?.type !== 'GUILD_TEXT') {
			logger.error(`Channel: ${statusLink.channel} is not a guild text channel`);
			return;
		}

		const msg = link.discordMessageId ? await channel.messages.fetch(link.discordMessageId)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching message (${eventId})`);
				logger.error('%o', err);
				encounteredError = true;
			}) as Message : undefined;
		if (encounteredError) return;

		if (transitionName === 'Assign') {
			const row = new MessageActionRow()
				.addComponents(
					new MessageButton()
						.setCustomId(`assignToMe:${req.body.issue.key}`)
						.setLabel('Assign to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields.assignee !== null),
				);
			link.progressStart = undefined;

			if (req.body.issue.fields.assignee === null) {
				if (link.hasAssignment & (1 << 0)) {
					link.hasAssignment -= (1 << 0);

					if (link.inProgress & (1 << 0)) {
						link.inProgress -= (1 << 0);
					}

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});

					const user = await UserInfo.findOne({ assignedTo: link.jiraKey }).exec()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while fetching user from db (${eventId})`);
							logger.error('%o', err);
							encounteredError = true;
						});
					if (encounteredError || !user) return;

					user.assignedAs.delete(req.body.issue.key);
					user.updateRequested.delete(req.body.issue.key);
					user.updateRequestCount.delete(req.body.issue.key);
					const newAssignedTo = [...user.assignedTo];
					// eslint-disable-next-line max-len
					newAssignedTo.splice(user.assignedTo.findIndex((el) => el === req.body.issue.key), 1);
					user.assignedTo = newAssignedTo;
					user.lastAssigned = new Date();

					user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user in db (${eventId})`);
							logger.error('%o', err);
						}
					});
				}

				const status = req.body.issue.fields.status.name;

				if (msg) {
					const embed = msg.embeds[0].spliceFields(1, 1, {
						name: 'Assignee',
						value: 'Unassigned',
					} as any);

					await msg.edit({
						embeds: [embed],
						components: (status === 'Open' || status === 'Rejected' || status === 'Being clipped' || status === 'Uploaded') ? [] : [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while editing message on Discord (${eventId})`);
						logger.error('%o', err);
					});
				} else {
					logger.verbose(`No message found for ${req.body.issue.key}, creating one`);
					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name!)
						.addField('Assignee', 'Unassigned')
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await channel.send({
						embeds: [embed],
						components: (status === 'Open' || status === 'Rejected' || status === 'Being clipped' || status === 'Uploaded') ? [] : [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
					});

					link.discordMessageId = newMsg?.id;
					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
				}

				await jiraClient.issueComments.addComment({
					issueIdOrKey: req.body.issue.key,
					body: 'Project assignee has been removed',
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while adding comment on Jira (${eventId})`);
				});
			} else {
				const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields.assignee.key },
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
				}).exec().catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from db (${eventId})`);
				});

				if (previousAssignedUser && previousAssignedUser._id !== user._id) {
					previousAssignedUser.assignedAs.delete(req.body.issue.key);
					previousAssignedUser.updateRequested.delete(req.body.issue.key);
					previousAssignedUser.updateRequestCount.delete(req.body.issue.key);
					const newAssignedTo = [...previousAssignedUser.assignedTo];
					// eslint-disable-next-line max-len
					newAssignedTo.splice(previousAssignedUser.assignedTo.findIndex((el) => el === req.body.issue.key), 1);
					previousAssignedUser.assignedTo = newAssignedTo;
					previousAssignedUser.lastAssigned = new Date();

					previousAssignedUser.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving user in db (${eventId})`);
							logger.error('%o', err);
						}
					});
				}

				if (previousAssignedUser?._id !== user._id) link.progressStart = undefined;

				if (link.inProgress & (1 << 0)) {
					link.inProgress -= (1 << 0);
				}
				if (!(link.hasAssignment & (1 << 0))) {
					link.hasAssignment += (1 << 0);
				}

				link.lastUpdate = new Date();

				link.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error saving issue link (${eventId})`);
						logger.error('%o', err);
					}
				});

				let userDoc = await UserInfo.findById(user._id).exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error finding user in db (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}

				userDoc.lastAssigned = new Date();
				userDoc.assignedTo.push(req.body.issue.key);

				userDoc.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error saving user in db (${eventId})`);
						logger.error('%o', err);
					}
				});

				if (msg) {
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
						logger.error('%o', err);
					});
				} else {
					logger.verbose(`No message found for ${req.body.issue.key}, creating one`);
					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name!)
						.addField('Assignee', `<@${user._id}>`)
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await channel.send({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
					});

					link.discordMessageId = newMsg?.id;
					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
				}

				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching Discord user (${eventId})`);
						logger.error('%o', err);
					});

				await jiraClient.issueComments.addComment({
					issueIdOrKey: req.body.issue.key,
					body: `Project assignee now is [~${req.body.issue.fields.assignee.name}]`,
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while adding comment on Jira (${eventId})`);
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
						.setDisabled(req.body.issue.fields[config.jira.fields.LQCAssignee] !== null),
				).addComponents(
					new MessageButton()
						.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
						.setLabel('Assign SQC to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields[config.jira.fields.SQCAssignee] !== null),
				);
			link.lqcProgressStart = undefined;

			if (req.body.issue.fields[config.jira.fields.LQCAssignee] === null) {
				if (msg) {
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
						logger.error('%o', err);
					});
				} else {
					logger.verbose(`No message found for ${req.body.issue.key}, creating one`);

					let SubQCAssignee = 'Unassigned';
					if (req.body.issue.fields[config.jira.fields.SQCAssignee] !== null) {
						const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
							params: { key: req.body.issue.fields[config.jira.fields.SQCAssignee].key },
							auth: {
								username: config.oauthServer.clientId,
								password: config.oauthServer.clientSecret,
							},
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
							SubQCAssignee = '(Encountered error)';
						});
						if (oauthUserRes?.data) SubQCAssignee = `<@${oauthUserRes.data._id}>`;
					}

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name!)
						.addField('LQC Assignee', 'Unassigned', true)
						.addField('SQC Assignee', SubQCAssignee, true)
						.addField('LQC Status', 'To do')
						.addField(
							'SQC Status',
							(
								// eslint-disable-next-line no-nested-ternary
								(req.body.issue.fields[config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'Sub_QC_done') ? 'Done' : (
									req.body.issue.fields[config.jira.fields.SQCAssignee] === null ? 'To do' : 'In progress'
								) ?? 'To do'
							),
						)
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await channel.send({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
					});

					link.discordMessageId = newMsg?.id;
					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
				}

				if (link.hasAssignment & (1 << 1)) {
					link.hasAssignment -= (1 << 1);

					if (link.inProgress & (1 << 1)) {
						link.inProgress -= (1 << 1);
					}

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});

					const user = await UserInfo.findOne({ assignedTo: link.jiraKey, assignedAs: 'lqc' }).exec()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error finding user in db (${eventId})`);
							logger.error('%o', err);
							encounteredError = true;
						});

					if (encounteredError || !user) return;
					user.assignedAs.delete(req.body.issue.key);
					user.updateRequested.delete(req.body.issue.key);
					user.updateRequestCount.delete(req.body.issue.key);
					const newAssignedTo = [...user.assignedTo];
					// eslint-disable-next-line max-len
					newAssignedTo.splice(user.assignedTo.findIndex((el) => el === req.body.issue.key), 1);
					user.assignedTo = newAssignedTo;
					user.lastAssigned = new Date();

					user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving user in db (${eventId})`);
							logger.error('%o', err);
						}
					});
				}

				await jiraClient.issueComments.addComment({
					issueIdOrKey: req.body.issue.key,
					body: 'LQC is now unassigned',
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while adding comment on Jira (${eventId})`);
				});
			} else {
				const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields[config.jira.fields.LQCAssignee].key },
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
				}).exec().catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from db (${eventId})`);
				});

				if (previousAssignedUser && previousAssignedUser._id !== user._id) {
					previousAssignedUser.assignedAs.delete(req.body.issue.key);
					previousAssignedUser.updateRequested.delete(req.body.issue.key);
					previousAssignedUser.updateRequestCount.delete(req.body.issue.key);
					const newAssignedTo = [...previousAssignedUser.assignedTo];
					// eslint-disable-next-line max-len
					newAssignedTo.splice(previousAssignedUser.assignedTo.findIndex((el) => el === req.body.issue.key), 1);
					previousAssignedUser.assignedTo = newAssignedTo;
					previousAssignedUser.lastAssigned = new Date();

					previousAssignedUser.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user in db (${eventId})`);
							logger.error('%o', err);
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
						logger.error('%o', err);
					}
				});

				let userDoc = await UserInfo.findById(user._id).exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching user from db (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});
				if (encounteredError) return;
				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}

				userDoc.lastAssigned = new Date();
				userDoc.assignedTo.push(req.body.issue.key);
				userDoc.assignedAs.set(req.body.issue.key, 'lqc');

				userDoc.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving user in db (${eventId})`);
						logger.error('%o', err);
					}
				});

				if (msg) {
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
						logger.error('%o', err);
					});
				} else {
					logger.verbose(`No message found for ${req.body.issue.key}, creating one`);

					let SubQCAssignee = 'Unassigned';
					if (req.body.issue.fields[config.jira.fields.SQCAssignee] !== null) {
						const oauthSQCUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
							params: { key: req.body.issue.fields[config.jira.fields.SQCAssignee].key },
							auth: {
								username: config.oauthServer.clientId,
								password: config.oauthServer.clientSecret,
							},
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
							SubQCAssignee = '(Encountered error)';
						});
						if (oauthSQCUserRes?.data) SubQCAssignee = `<@${oauthSQCUserRes.data._id}>`;
					}

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name!)
						.addField('LQC Assignee', `<@${user._id}>`, true)
						.addField('SQC Assignee', SubQCAssignee, true)
						.addField('LQC Status', 'To do')
						.addField(
							'SQC Status',
							(
								// eslint-disable-next-line no-nested-ternary
								(req.body.issue.fields[config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'Sub_QC_done') ? 'Done' : (
									req.body.issue.fields[config.jira.fields.SQCAssignee] === null ? 'To do' : 'In progress'
								) ?? 'To do'
							),
						)
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await channel.send({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
					});

					link.discordMessageId = newMsg?.id;
					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
				}

				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching user on Discord (${eventId})`);
						logger.error('%o', err);
					});

				await jiraClient.issueComments.addComment({
					issueIdOrKey: req.body.issue.key,
					body: `LQC assignee now is [~${req.body.issue.fields.assignee.name}]`,
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while adding comment on Jira (${eventId})`);
				});
			}
		} else if (transitionName === 'Assign SQC') {
			const row = new MessageActionRow()
				.addComponents(
					new MessageButton()
						.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
						.setLabel('Assign LQC to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields[config.jira.fields.LQCAssignee] !== null),
				).addComponents(
					new MessageButton()
						.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
						.setLabel('Assign SQC to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields[config.jira.fields.SQCAssignee] !== null),
				);

			link.sqcProgressStart = undefined;

			if (req.body.issue.fields[config.jira.fields.SQCAssignee] === null) {
				if (msg) {
					const embed = msg.embeds[0].spliceFields(2, 1, {
						name: 'SQC Assignee',
						value: 'Unassigned',
						inline: true,
					} as any);

					await msg.edit({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while editing message in Discord user (${eventId})`);
						logger.error('%o', err);
					});
				} else {
					logger.verbose(`No message found for ${req.body.issue.key}, creating one`);

					let LQCAssignee = 'Unassigned';
					if (req.body.issue.fields[config.jira.fields.LQCAssignee] !== null) {
						const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
							params: { key: req.body.issue.fields[config.jira.fields.LQCAssignee].key },
							auth: {
								username: config.oauthServer.clientId,
								password: config.oauthServer.clientSecret,
							},
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
							LQCAssignee = '(Encountered error)';
						});
						if (oauthUserRes?.data) LQCAssignee = `<@${oauthUserRes.data._id}>`;
					}

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name!)
						.addField('LQC Assignee', LQCAssignee, true)
						.addField('SQC Assignee', 'Unassigned', true)
						.addField(
							'LQC Status',
							(
								// eslint-disable-next-line no-nested-ternary
								(req.body.issue.fields[config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'LQC_done') ? 'Done' : (
									req.body.issue.fields[config.jira.fields.LQCAssignee] === null ? 'To do' : 'In progress'
								) ?? 'To do'
							),
						)
						.addField('SQC Status', 'To do')
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await channel.send({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
					});

					link.discordMessageId = newMsg?.id;
					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
				}

				if (link.hasAssignment & (1 << 2)) {
					link.hasAssignment -= (1 << 2);

					if (link.inProgress & (1 << 2)) {
						link.inProgress -= (1 << 2);
					}
					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});

					const user = await UserInfo.findOne({ assignedTo: link.jiraKey, assignedAs: 'sqc' }).exec()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error finding user in db (${eventId})`);
							logger.error('%o', err);
							encounteredError = true;
						});

					if (encounteredError || !user) return;
					user.assignedAs.delete(req.body.issue.key);
					user.updateRequested.delete(req.body.issue.key);
					user.updateRequestCount.delete(req.body.issue.key);
					const newAssignedTo = [...user.assignedTo];
					// eslint-disable-next-line max-len
					newAssignedTo.splice(user.assignedTo.findIndex((el) => el === req.body.issue.key), 1);
					user.assignedTo = newAssignedTo;
					user.lastAssigned = new Date();

					user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving user in db (${eventId})`);
							logger.error('%o', err);
						}
					});

					await jiraClient.issueComments.addComment({
						issueIdOrKey: req.body.issue.key,
						body: 'SQC is now unassigned',
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while adding comment on Jira (${eventId})`);
					});
				}
			} else {
				const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields[config.jira.fields.SQCAssignee].key },
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
				}).exec().catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from db (${eventId})`);
				});

				if (previousAssignedUser && previousAssignedUser._id !== user._id) {
					previousAssignedUser.assignedAs.delete(req.body.issue.key);
					previousAssignedUser.updateRequested.delete(req.body.issue.key);
					previousAssignedUser.updateRequestCount.delete(req.body.issue.key);
					const newAssignedTo = [...previousAssignedUser.assignedTo];
					// eslint-disable-next-line max-len
					newAssignedTo.splice(previousAssignedUser.assignedTo.findIndex((el) => el === req.body.issue.key), 1);
					previousAssignedUser.assignedTo = newAssignedTo;
					previousAssignedUser.lastAssigned = new Date();

					previousAssignedUser.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user in db (${eventId})`);
							logger.error('%o', err);
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
						logger.error('%o', err);
					}
				});

				let userDoc = await UserInfo.findById(user._id).exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching user from db (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}

				userDoc.lastAssigned = new Date();
				userDoc.assignedTo.push(req.body.issue.key);
				userDoc.assignedAs.set(req.body.issue.key, 'sqc');

				userDoc.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving user in db (${eventId})`);
						logger.error('%o', err);
					}
				});

				if (msg) {
					const embed = msg.embeds[0].spliceFields(2, 1, {
						name: 'SQC Assignee',
						value: `<@${user._id}>`,
						inline: true,
					} as any);

					await msg.edit({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while editing message in Discord user (${eventId})`);
						logger.error('%o', err);
					});
				} else {
					logger.verbose(`No message found for ${req.body.issue.key}, creating one`);

					let LQCAssignee = 'Unassigned';
					if (req.body.issue.fields[config.jira.fields.LQCAssignee] !== null) {
						const oauthLQCUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
							params: { key: req.body.issue.fields[config.jira.fields.LQCAssignee].key },
							auth: {
								username: config.oauthServer.clientId,
								password: config.oauthServer.clientSecret,
							},
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
							LQCAssignee = '(Encountered error)';
						});
						if (oauthLQCUserRes?.data) LQCAssignee = `<@${oauthLQCUserRes.data._id}>`;
					}

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name!)
						.addField('LQC Assignee', LQCAssignee, true)
						.addField('SQC Assignee', `<@${user._id}>`, true)
						.addField(
							'LQC Status',
							(
								// eslint-disable-next-line no-nested-ternary
								(req.body.issue.fields[config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'LQC_done') ? 'Done' : (
									req.body.issue.fields[config.jira.fields.LQCAssignee] === null ? 'To do' : 'In progress'
								) ?? 'To do'
							),
						)
						.addField('SQC Status', 'To do')
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await channel.send({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
					});

					link.discordMessageId = newMsg?.id;
					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
				}

				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser);
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching user on Discord (${eventId})`);
						logger.error('%o', err);
					});

				await jiraClient.issueComments.addComment({
					issueIdOrKey: req.body.issue.key,
					body: `SQC assignee now is [~${req.body.issue.fields.assignee.name}]`,
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while adding comment on Jira (${eventId})`);
				});
			}
		} else {
			// eslint-disable-next-line max-len
			link.languages = req.body.issue.fields[config.jira.fields.langs].map((language: JiraField) => language.value);
			link.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving issue link (${eventId})`);
					logger.error('%o', err);
				}
			});

			const row = new MessageActionRow()
				.addComponents(
					new MessageButton()
						.setCustomId(`assignToMe:${req.body.issue.key}`)
						.setLabel('Assign to me')
						.setStyle('SUCCESS')
						.setEmoji('819518919739965490')
						.setDisabled(req.body.issue.fields.assignee !== null),
				);

			if (req.body.issue.fields.status.name === link.status) {
				if (link.status === 'Sub QC/Language QC') {
					const newRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
								.setLabel('Assign LQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields[config.jira.fields.LQCAssignee] !== null),
						).addComponents(
							new MessageButton()
								.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
								.setLabel('Assign SQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields[config.jira.fields.SQCAssignee] !== null),
						);

					let LQCAssignee = 'Unassigned';
					let SubQCAssignee = 'Unassigned';

					if (msg) {
						LQCAssignee = msg.embeds[0].fields[1].value;
						SubQCAssignee = msg.embeds[0].fields[2].value;
					} else {
						if (req.body.issue.fields[config.jira.fields.LQCAssignee] !== null) {
							const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
								params: { key: req.body.issue.fields[config.jira.fields.LQCAssignee].key },
								auth: {
									username: config.oauthServer.clientId,
									password: config.oauthServer.clientSecret,
								},
							}).catch((err) => {
								const eventId = Sentry.captureException(err);
								logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
								LQCAssignee = '(Encountered error)';
							});
							if (oauthUserRes?.data) LQCAssignee = `<@${oauthUserRes.data._id}>`;
						}
						if (req.body.issue.fields[config.jira.fields.SQCAssigneeS] !== null) {
							const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
								params: { key: req.body.issue.fields[config.jira.fields.SQCAssignee].key },
								auth: {
									username: config.oauthServer.clientId,
									password: config.oauthServer.clientSecret,
								},
							}).catch((err) => {
								const eventId = Sentry.captureException(err);
								logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
								SubQCAssignee = '(Encountered error)';
							});
							if (oauthUserRes?.data) SubQCAssignee = `<@${oauthUserRes.data._id}>`;
						}
					}

					const embed = new MessageEmbed()
						.setTitle(req.body.issue.key!)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.summary ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name)
						.addField('LQC Assignee', LQCAssignee, true)
						.addField('SQC Assignee', SubQCAssignee, true)
						.addField(
							'LQC Status',
							(
								// eslint-disable-next-line no-nested-ternary
								(req.body.issue.fields[config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'LQC_done') ? 'Done' : (
									req.body.issue.fields[config.jira.fields.LQCAssignee] === null ? 'To do' : 'In progress'
								) ?? 'To do'
							),
						)
						.addField(
							'SQC Status',
							(
								// eslint-disable-next-line no-nested-ternary
								(req.body.issue.fields[config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'Sub_QC_done') ? 'Done' : (
									req.body.issue.fields[config.jira.fields.SQCAssignee] === null ? 'To do' : 'In progress'
								) ?? 'To do'
							),
						)
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					if (msg) {
						await msg.edit({
							embeds: [embed],
							components: [newRow],
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while editing message in Discord user (${eventId})`);
							logger.error('%o', err);
						});
					} else {
						logger.verbose(`No message found for ${req.body.issue.key}, creating one`);

						const newMsg = await channel.send({
							embeds: [embed],
							components: [row],
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while sending message (${eventId})`);
							logger.error('%o', err);
						});

						link.discordMessageId = newMsg?.id;
						link.save((err) => {
							if (err) {
								const eventId = Sentry.captureException(err);
								logger.error(`Encountered error while saving issue link (${eventId})`);
								logger.error('%o', err);
							}
						});
					}
				} else {
					let assignee = 'Unassigned';
					if (msg) {
						assignee = msg.embeds[0].fields[1].value;
					} else if (req.body.issue.fields.assignee) {
						const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
							params: { key: req.body.issue.fields.assignee.key },
							auth: {
								username: config.oauthServer.clientId,
								password: config.oauthServer.clientSecret,
							},
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
							assignee = '(Encountered error)';
						});
						if (oauthUserRes?.data) assignee = `<@${oauthUserRes.data._id}>`;
					}

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name)
						.addField('Assignee', assignee)
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					if (msg) {
						await msg.edit({
							embeds: [embed],
							components: [row],
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while editing message in Discord user (${eventId})`);
							logger.error('%o', err);
						});
					} else {
						logger.verbose(`No message found for ${req.body.issue.key}, creating one`);

						const newMsg = await channel.send({
							embeds: [embed],
							components: [row],
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while sending message (${eventId})`);
							logger.error('%o', err);
						});

						link.discordMessageId = newMsg?.id;
						link.save((err) => {
							if (err) {
								const eventId = Sentry.captureException(err);
								logger.error(`Encountered error while saving issue link (${eventId})`);
								logger.error('%o', err);
							}
						});
					}
				}
			} else {
				const assignedUsers = await UserInfo.find({ assignedTo: req.body.issue.key }).exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching users from db (${eventId})`);
					});

				// eslint-disable-next-line array-callback-return
				assignedUsers?.map((user) => {
					/* eslint-disable no-param-reassign */
					user.assignedAs.delete(req.body.issue.key);
					user.updateRequested.delete(req.body.issue.key);
					user.updateRequestCount.delete(req.body.issue.key);
					const newAssignedTo = [...user.assignedTo];
					// eslint-disable-next-line max-len
					newAssignedTo.splice(user.assignedTo.findIndex((el) => el === req.body.issue.key), 1);
					user.assignedTo = newAssignedTo;
					user.lastAssigned = new Date();

					user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user in db (${eventId})`);
							logger.error('%o', err);
						}
					});
					/* eslint-enable */
				});

				// eslint-disable-next-line max-len
				const newStatusLink = await StatusLink.findById(req.body.issue.fields.status.name).lean().exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching status link (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!newStatusLink) {
					logger.warn(`No channel link found for: ${req.body.issue.fields.status.name}`);
					link.discordMessageId = undefined;
					link.status = req.body.issue.fields.status.name!;
					link.lastUpdate = new Date();
					link.hasAssignment = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});
					return;
				}

				const newChannel = await client.channels.fetch(newStatusLink.channel)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching Discord channel (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					}) as TextChannel | null;
				if (encounteredError) return;

				if (newChannel?.type !== 'GUILD_TEXT') {
					logger.error(`Channel: ${newStatusLink.channel} is not a guild text channel`);
					return;
				}

				if (req.body.issue.fields.status.name === 'Sub QC/Language QC') {
					const newRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setCustomId(`assignLQCToMe:${req.body.issue.key}`)
								.setLabel('Assign LQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields[config.jira.fields.LQCAssignee] !== null),
						).addComponents(
							new MessageButton()
								.setCustomId(`assignSQCToMe:${req.body.issue.key}`)
								.setLabel('Assign SQC to me')
								.setStyle('SUCCESS')
								.setEmoji('819518919739965490')
								.setDisabled(req.body.issue.fields[config.jira.fields.SQCAssignee] !== null),
						);

					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name)
						.addField('LQC Assignee', 'Unassigned', true)
						.addField('SQC Assignee', 'Unassigned', true)
						.addField('LQC Status', 'To do')
						.addField('SQC Status', 'To do')
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: [newRow],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
					});

					link.discordMessageId = newMsg?.id ?? undefined;
					link.status = req.body.issue.fields.status.name;
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
							logger.error('%o', err);
						}
					});

					if (!msg) logger.warn(`No message to delete, this might be wrong. (${req.body.issue.key}`);
					await msg?.delete()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while deleting message (${eventId})`);
							logger.error('%o', err);
						});
				} else if (req.body.issue.fields.status.name === 'Ready for release') {
					const embed = new MessageEmbed()
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name)
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						content: 'New project ready for release',
						embeds: [embed],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message (${eventId})`);
						logger.error('%o', err);
					});

					link.discordMessageId = newMsg?.id ?? undefined;
					link.status = req.body.issue.fields.status.name;
					link.lastUpdate = new Date();
					link.hasAssignment = 0;

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});

					if (!msg) logger.warn(`No message to delete, this might be wrong. (${req.body.issue.key}`);
					await msg?.delete()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while deleting message (${eventId})`);
							logger.error('%o', err);
						});
				} else {
					let user: any | undefined;
					if (req.body.issue.fields.assignee !== null) {
						link.hasAssignment = (1 << 0);

						const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
							params: { key: req.body.issue.fields.assignee.key },
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
						.setTitle(`${req.body.issue.key}: ${req.body.issue.fields.summary}`)
						.setColor('#0052cc')
						.setDescription(req.body.issue.fields.description ?? 'No description available')
						.addField('Status', req.body.issue.fields.status.name!)
						// eslint-disable-next-line no-nested-ternary
						.addField('Assignee', (user ? `<@${user._id}>` : (encounteredError ? '(Encountered error)' : 'Unassigned')))
						.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
						.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
						.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

					const newMsg = await newChannel.send({
						embeds: [embed],
						components: [row],
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while sending message to Discord user (${eventId})`);
						logger.error('%o', err);
					});

					link.discordMessageId = newMsg?.id ?? undefined;
					link.status = req.body.issue.fields.status.name!;
					link.lastUpdate = new Date();

					link.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error('%o', err);
						}
					});

					if (!msg) logger.warn(`No message to delete, this might be wrong. (${req.body.issue.key}`);
					await msg?.delete()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while deleting message (${eventId})`);
							logger.error('%o', err);
						});
				}

				await jiraClient.issueComments.addComment({
					issueIdOrKey: req.body.issue.key,
					body: `Project has transitioned to ${req.body.issue.fields.status.name}`,
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while adding comment on Jira (${eventId})`);
				});
			}
		}
	}
});

router.post('/webhook/artist', async (req, res) => {
	if (req.query.token !== config.webhookSecret) {
		res.status(403).end();
		return;
	}
	res.status(200).end();

	let encounteredError = false;

	const row = new MessageActionRow()
		.addComponents(
			new MessageButton()
				.setCustomId(`artist:assignToMe:${req.body.issue.key}`)
				.setLabel('Assign to me')
				.setStyle('SUCCESS')
				.setEmoji('819518919739965490')
				.setDisabled((req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') ? false : req.body.issue.fields.assignee !== null),
		);

	let assignee = 'Unassigned';
	let user: any;
	if (req.body.issue.fields.assignee) {
		const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
			params: { key: req.body.issue.fields.assignee.key },
			auth: {
				username: config.oauthServer.clientId,
				password: config.oauthServer.clientSecret,
			},
		}).catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
			assignee = '(Encountered error)';
		});
		if (oauthUserRes?.data) {
			user = oauthUserRes.data;
			assignee = `<@${oauthUserRes.data._id}>`;
		}
	}

	const embed = new MessageEmbed()
		.setTitle(`${req.body.issue.key}`)
		.setColor('#0052cc')
		.setDescription(req.body.issue.fields.summary ?? 'No description available')
		.addField('Status', req.body.issue.fields.status.name!)
		.addField('Assignee', assignee)
		.addField('Source', `[link](${req.body.issue.fields[config.jira.fields.videoLink]})`)
		.setFooter({ text: `Due date: ${req.body.issue.fields.duedate || 'unknown'}` })
		.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

	const channelLink = await StatusLink.findById('internal:artist-channel').lean().exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while finding channel link (${eventId})`);
			logger.error('%o', err);
			encounteredError = true;
		});
	if (encounteredError) return;

	if (!channelLink) {
		logger.warn(`No channel link for ${req.body.issue.fields.status.name} found!`);
		return;
	}

	const channel = await client.channels.fetch(channelLink.channel)
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while finding Discord channel (${eventId})`);
			logger.error('%o', err);
			encounteredError = true;
		}) as TextChannel;
	if (encounteredError) return;

	if (channel?.type !== 'GUILD_TEXT') {
		logger.error(`Channel: ${channelLink.channel} is not a guild text channel`);
		return;
	}

	if (req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') {
		logger.verbose('New Jira issue webhook triggered (artist)');

		const link = new IdLink({
			jiraKey: req.body.issue.key,
			type: 'artist',
			status: req.body.issue.fields.status.name,
			lastUpdate: new Date(),
			lastStatusChange: new Date(),
		});

		const msg = await channel.send({
			embeds: [embed],
			components: [row],
		}).catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while sending message (${eventId})`);
			logger.error('%o', err);
			encounteredError = true;
		});
		if (encounteredError) return;

		link.discordMessageId = msg?.id;
		link.save((err) => {
			if (err) {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while saving issue link (${eventId})`);
				logger.error('%o', err);
			}
		});
	} else {
		// Get the project from the db
		let link = await IdLink.findOne({ jiraKey: req.body.issue.key })
			.exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while finding issue link (${eventId})`);
				logger.error('%o', err);
				encounteredError = true;
			}) as Document<any, any, Project> & Project;
		if (encounteredError) return;

		if (!link) {
			link = new IdLink({
				jiraKey: req.body.issue.key,
				type: 'artist',
				status: req.body.issue.fields.status.name,
				lastUpdate: new Date(),
				lastStatusChange: new Date(),
			});
		}

		if (link.finished || link.abandoned) return;

		const transitionName = req.body.transition?.transitionName;

		let msg: Message | void;
		if (link.discordMessageId) {
			msg = await channel.messages.fetch(link.discordMessageId)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching Discord channel (${eventId})`);
					logger.error('%o', err);
				});
		}

		if (transitionName === 'Abandon project' || transitionName === 'Approve') {
			await msg?.delete();

			if (link.hasAssignment > 0) {
				const previousAssignedUsers = await UserInfo.find({
					isAssigned: true,
					assignedTo: req.body.issue.key,
				}).exec().catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching users from db (${eventId})`);
				});

				previousAssignedUsers?.forEach((previousAssignedUser) => {
					/* eslint-disable no-param-reassign */
					previousAssignedUser.assignedAs.delete(req.body.issue.key);
					previousAssignedUser.updateRequested.delete(req.body.issue.key);
					previousAssignedUser.updateRequestCount.delete(req.body.issue.key);
					const newAssignedTo = [...previousAssignedUser.assignedTo];
					// eslint-disable-next-line max-len
					newAssignedTo.splice(previousAssignedUser.assignedTo.findIndex((el) => el === req.body.issue.key), 1);
					previousAssignedUser.assignedTo = newAssignedTo;
					previousAssignedUser.lastAssigned = new Date();

					previousAssignedUser.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error saving user in db (${eventId})`);
							logger.error('%o', err);
						}
					});
					/* eslint-enable */
				});
			}
			if (transitionName === 'Approve') {
				link.finished = true;
			} else if (transitionName === 'Abandon project') {
				link.abandoned = true;
			}
			link.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving issue link (${eventId})`);
					logger.error('%o', err);
				}
			});
		} else if (transitionName === 'Assign') {
			const previousAssignedUser = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: req.body.issue.key,
			}).exec().catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching user from db (${eventId})`);
			});

			if (previousAssignedUser && previousAssignedUser._id !== user?._id) {
				previousAssignedUser.assignedAs.delete(req.body.issue.key);
				previousAssignedUser.updateRequested.delete(req.body.issue.key);
				previousAssignedUser.updateRequestCount.delete(req.body.issue.key);
				const newAssignedTo = [...previousAssignedUser.assignedTo];
				// eslint-disable-next-line max-len
				newAssignedTo.splice(previousAssignedUser.assignedTo.findIndex((el) => el === req.body.issue.key), 1);
				previousAssignedUser.assignedTo = newAssignedTo;
				previousAssignedUser.lastAssigned = new Date();

				previousAssignedUser.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error saving user in db (${eventId})`);
						logger.error('%o', err);
					}
				});

				if (link.inProgress === 1) link.inProgress = 0;
			}
			if (!req.body.fields.assignee) link.hasAssignment = 0;
			if (req.body.fields.assignee && link.hasAssignment !== 1) link.hasAssignment = 1;

			link.lastUpdate = new Date();

			link.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error saving issue link (${eventId})`);
					logger.error('%o', err);
				}
			});

			if (user && previousAssignedUser?._id !== user._id) {
				link.progressStart = undefined;

				let userDoc = await UserInfo.findById(user._id).exec()
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error finding user in db (${eventId})`);
						logger.error('%o', err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (!userDoc) {
					userDoc = new UserInfo({
						_id: user._id,
					});
				}

				userDoc.assignedTo.push(req.body.issue.key);
				userDoc.lastAssigned = new Date();

				userDoc.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error saving user in db (${eventId})`);
						logger.error('%o', err);
					}
				});

				client.users.fetch(user._id)
					.then((fetchedUser) => {
						sendUserAssignedEmbed(link, fetchedUser, 'artist');
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching Discord user (${eventId})`);
						logger.error('%o', err);
					});
			}

			if (msg) {
				msg.edit({
					embeds: [embed],
					components: [row],
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while editing message in Discord user (${eventId})`);
					logger.error('%o', err);
				});
			} else {
				logger.verbose(`No message found for ${req.body.issue.key}, creating one`);

				const newMsg = await channel.send({
					embeds: [embed],
					components: [row],
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while sending message (${eventId})`);
					logger.error('%o', err);
				});

				link.discordMessageId = newMsg?.id;
			}
			link.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving issue link (${eventId})`);
					logger.error('%o', err);
				}
			});
		} else {
			// Do this whenever the issue is updated and isn't one of the above transitions
			// eslint-disable-next-line no-lonely-if
			if (msg) {
				await msg.edit({
					embeds: [embed],
					components: [row],
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while editing message in Discord user (${eventId})`);
					logger.error('%o', err);
				});
			} else {
				logger.verbose(`No message found for ${req.body.issue.key}, creating one`);

				const newMsg = await channel.send({
					embeds: [embed],
					components: [row],
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while sending message (${eventId})`);
					logger.error('%o', err);
				});

				link.discordMessageId = newMsg?.id;
				link.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving issue link (${eventId})`);
						logger.error('%o', err);
					}
				});
			}
		}
	}
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
