import axios from 'axios';
import format from 'string-template';
import { Document } from 'mongoose';
import {
	MessageActionRow, MessageButton, MessageEmbed, TextChannel,
} from 'discord.js';
import humanizeDuration from 'humanize-duration';
import cron from 'node-cron';
import IdLink, { Project } from '../models/IdLink';
import GroupLink from '../models/GroupLink';
import UserInfo from '../models/UserInfo';
import { client, jiraClient, logger } from '../index';
import checkValid from './checkValid';
import Setting from '../models/Setting';
import { allServicesOnline } from './middleware';

const config = require('../config.json');
const strings = require('../strings.json');

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
		logger.info(`Somehow, there's no one available for: ${project.jiraKey} ${role ? `(${role})` : ''}`);
		return;
	}

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
			}).then(async () => {
				await discordUser.send(format(strings.autoAssignedTo, { jiraKey: project.jiraKey }));
				await jiraClient.issueComments.addComment({
					issueIdOrKey: project.jiraKey!,
					body: `Auto assigned SubQC to [~${user.username}].`,
				});
			}).catch((err) => {
				logger.error(err);
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
			}).then(async () => {
				await discordUser.send(format(strings.autoAssignedTo, { jiraKey: project.jiraKey }));
				await jiraClient.issueComments.addComment({
					issueIdOrKey: project.jiraKey!,
					body: `Auto assigned LQC to [~${user.username}].`,
				});
			}).catch((err) => {
				logger.error(err);
			});
		}
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
		}).then(async () => {
			await discordUser.send(format(strings.autoAssignedTo, { jiraKey: project.jiraKey }));
			await jiraClient.issueComments.addComment({
				issueIdOrKey: project.jiraKey!,
				body: `Auto assigned project to [~${user.username}].`,
			});
		}).catch((err) => {
			logger.error(err);
		});
	}
}

async function projectRequestInProgressMark(project: Document<any, any, Project> & Project) {
	const repeatRequestAfter = await Setting.findById('repeatRequestAfter').lean().exec();
	const compareDate = new Date(
		Date.now()
		// Fallback is 4 days.
		- (repeatRequestAfter ? parseInt(repeatRequestAfter.value, 10) : 4 * 24 * 60 * 60 * 1000),
	);

	if (project.status === 'Sub QC/Language QC') {
		if (!(project.inProgress & (1 << 1))) {
			const user = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: project.jiraKey,
				assignedAs: 'lqc',
			}).exec();

			if (user && (user.updateRequested! < compareDate)) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						logger.error(err);
					});
				if (discordUser) {
					if (user.updateRequestCount === 3) {
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
						return;
					}

					const embed = new MessageEmbed()
						.setTitle(`Requesting update for: **${project.jiraKey}**`)
						.setDescription(format(strings.updateRequest, { time: `<t:${Math.floor(new Date(Date.now() + (repeatRequestAfter ? parseInt(repeatRequestAfter.value, 10) : 4 * 24 * 60 * 60 * 1000)).getTime() / 1000)}:R>` }))
						.setURL(`${config.jira.url}/browse/${project.jiraKey}`);

					const componentRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setStyle('SUCCESS')
								.setCustomId(`markInProgress:${project.jiraKey}`)
								.setLabel('Mark in progress'),
						)
						.addComponents(
							new MessageButton()
								.setStyle('DANGER')
								.setCustomId(`abandonProject:${project.jiraKey}`)
								.setLabel('Abandon project'),
						);

					if (user.updateRequestCount === 2) embed.setDescription(format(strings.lastUpdateUpdateRequest, { time: `<t:${Math.floor(new Date(Date.now() + (repeatRequestAfter ? parseInt(repeatRequestAfter.value, 10) : 4 * 24 * 60 * 60 * 1000)).getTime() / 1000)}:R>` }));

					await discordUser.send({ embeds: [embed], components: [componentRow] });
					user.updateRequested = new Date();
					user.updateRequestCount += 1;
					await user.save((err) => {
						if (err) logger.error(err);
					});
					await jiraClient.issueComments.addComment({
						issueIdOrKey: project.jiraKey!,
						body: 'Project has not been marked in progress yet, asking again.',
					});
				}
			}
		}
		if (!(project.inProgress & (1 << 2))) {
			const user = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: project.jiraKey,
				assignedAs: 'sqc',
			}).exec();

			if (user && (user.updateRequested! < compareDate)) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						logger.error(err);
					});
				if (discordUser) {
					if (user.updateRequestCount === 3) {
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
						return;
					}

					const embed = new MessageEmbed()
						.setTitle(`Requesting update for: **${project.jiraKey}**`)
						.setDescription(format(strings.updateRequest, { time: `<t:${Math.floor(new Date(Date.now() + (repeatRequestAfter ? parseInt(repeatRequestAfter.value, 10) : 4 * 24 * 60 * 60 * 1000)).getTime() / 1000)}:R>` }))
						.setURL(`${config.jira.url}/browse/${project.jiraKey}`);

					const componentRow = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setStyle('SUCCESS')
								.setCustomId(`markInProgress:${project.jiraKey}`)
								.setLabel('Mark in progress'),
						)
						.addComponents(
							new MessageButton()
								.setStyle('DANGER')
								.setCustomId(`abandonProject:${project.jiraKey}`)
								.setLabel('Abandon project'),
						);

					if (user.updateRequestCount === 2) embed.setDescription(format(strings.lastUpdateUpdateRequest, { time: `<t:${Math.floor(new Date(Date.now() + (repeatRequestAfter ? parseInt(repeatRequestAfter.value, 10) : 4 * 24 * 60 * 60 * 1000)).getTime() / 1000)}:R>` }));

					await discordUser.send({ embeds: [embed], components: [componentRow] });
					user.updateRequested = new Date();
					user.updateRequestCount += 1;
					await user.save((err) => {
						if (err) logger.error(err);
					});
					await jiraClient.issueComments.addComment({
						issueIdOrKey: project.jiraKey!,
						body: 'Project has not been marked in progress yet, asking again.',
					});
				}
			}
		}
	} else {
		const user = await UserInfo.findOne({
			isAssigned: true,
			assignedTo: project.jiraKey,
			assignedAs: 'sqc',
		}).exec();

		if (user && (user.updateRequested! < compareDate)) {
			const discordUser = await client.users.fetch(user._id)
				.catch((err) => {
					logger.error(err);
				});
			if (discordUser) {
				if (user.updateRequestCount === 3) {
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
					return;
				}

				const embed = new MessageEmbed()
					.setTitle(`Requesting update for: **${project.jiraKey}**`)
					.setDescription(format(strings.updateRequest, { time: `<t:${Math.floor(new Date(Date.now() + (repeatRequestAfter ? parseInt(repeatRequestAfter.value, 10) : 4 * 24 * 60 * 60 * 1000)).getTime() / 1000)}:R>` }))
					.setURL(`${config.jira.url}/browse/${project.jiraKey}`);

				const componentRow = new MessageActionRow()
					.addComponents(
						new MessageButton()
							.setStyle('SUCCESS')
							.setCustomId(`markInProgress:${project.jiraKey}`)
							.setLabel('Mark in progress'),
					)
					.addComponents(
						new MessageButton()
							.setStyle('DANGER')
							.setCustomId(`abandonProject:${project.jiraKey}`)
							.setLabel('Abandon project'),
					);

				if (user.updateRequestCount === 2) embed.setDescription(format(strings.lastUpdateUpdateRequest, { time: `<t:${Math.floor(new Date(Date.now() + (repeatRequestAfter ? parseInt(repeatRequestAfter.value, 10) : 4 * 24 * 60 * 60 * 1000)).getTime() / 1000)}:R>` }));

				await discordUser.send({ embeds: [embed], components: [componentRow] });
				user.updateRequested = new Date();
				user.updateRequestCount += 1;
				await user.save((err) => {
					if (err) logger.error(err);
				});
				await jiraClient.issueComments.addComment({
					issueIdOrKey: project.jiraKey!,
					body: 'Project has not been marked in progress yet, asking again.',
				});
			}
		}
	}
	await project.save((err) => {
		if (err) logger.error(err);
	});
}

async function staleAnnounce(project: Document<any, any, Project> & Project) {
	const teamLeadNotifySetting = await Setting.findById('teamLeadNotifyChannel').lean().exec();
	const maxTimeTaken = await Setting.findById('maxTimeTaken').lean().exec();
	// eslint-disable-next-line max-len
	const compareDate = new Date(Date.now() - (maxTimeTaken ? parseInt(maxTimeTaken.value, 10) : (30 * 24 * 60 * 60 * 1000)));
	const maxTimeStr = humanizeDuration(
		maxTimeTaken ? parseInt(maxTimeTaken.value, 10) : (30 * 24 * 60 * 60 * 1000),
		{
			largest: 1,
			units: ['m', 'd', 'h'],
			round: true,
		},
	);

	let channel: TextChannel | undefined;
	if (teamLeadNotifySetting) {
		channel = await client.channels.fetch(teamLeadNotifySetting.value)
			.catch((err) => {
				logger.error(err);
			}) as TextChannel;
	}
	if (!channel) {
		logger.info('Not announcing stale, no team lead channel found!');
		return;
	}

	if (project.status === 'Sub QC/Language QC') {
		const issue = await jiraClient.issues.getIssue({ issueIdOrKey: project.jiraKey! });
		const componentRow = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setStyle('DANGER')
					.setCustomId(`teamLead:abandonProject:${project.jiraKey}`)
					.setLabel('Abandon project'),
			);

		if (
			project.lqcProgressStart! < compareDate
			&& project.inProgress & (1 << 1)
			&& !((issue.fields![config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'LQC_done'))
		) {
			await jiraClient.issueComments.addComment({
				issueIdOrKey: project.jiraKey!,
				body: `LQC hasn't finished in ${maxTimeStr}, reporting to team leads.`,
			});
			componentRow.addComponents(
				new MessageButton()
					.setStyle('PRIMARY')
					.setCustomId(`teamLead:unassign-lqc:${project.jiraKey}`)
					.setLabel('Un-assign LQC'),
			);
		}
		if (
			project.sqcProgressStart! < compareDate
			&& project.inProgress & (1 << 2)
			&& !((issue.fields![config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'Sub_QC_done'))
		) {
			await jiraClient.issueComments.addComment({
				issueIdOrKey: project.jiraKey!,
				body: `SubQC hasn't finished in ${maxTimeStr}, reporting to team leads.`,
			});
			componentRow.addComponents(
				new MessageButton()
					.setStyle('PRIMARY')
					.setCustomId(`teamLead:unassign-sqc:${project.jiraKey}`)
					.setLabel('Un-assign SubQC'),
			);
		}
		if (componentRow.components.length > 1) {
			await channel.send({
				content: `LQC and/or SubQC hasn't finished ${project.jiraKey} in ${maxTimeStr}, please take action`,
				components: [componentRow],
			}).then(async () => {
				// eslint-disable-next-line no-param-reassign
				project.requestedTeamLeadAction = true;
				await project.save((err) => {
					if (err) logger.error(err);
				});
			});
		}
	} else {
		const componentRow = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setStyle('DANGER')
					.setCustomId(`teamLead:abandonProject:${project.jiraKey}`)
					.setLabel('Abandon project'),
				new MessageButton()
					.setStyle('PRIMARY')
					.setCustomId(`teamLead:unassign:${project.jiraKey}`)
					.setLabel('Un-assign project'),
			);

		await jiraClient.issueComments.addComment({
			issueIdOrKey: project.jiraKey!,
			body: `Project hasn't transitioned in ${maxTimeStr}, reporting to team leads.`,
		});

		await channel.send({
			content: `Assigned person hasn't finished ${project.jiraKey} in ${maxTimeStr}, please take action`,
			components: [componentRow],
		}).then(async () => {
			// eslint-disable-next-line no-param-reassign
			project.requestedTeamLeadAction = true;
			await project.save((err) => {
				if (err) logger.error(err);
			});
		});
	}
}

// !TODO: Change to one hour when in prod
cron.schedule('*/5 * * * *', async () => {
	if (!await allServicesOnline()) {
		logger.info('Unable to execute timer, a service is offline!');
		return;
	}
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
				autoAssignAfter ? parseInt(autoAssignAfter.value, 10) : (3 * 24 * 3600 * 1000))),
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

	const toRequestInProgress = await IdLink.find({
		$or: [
			{
				status: 'Sub QC/Language QC',
				inProgress: { $lt: (1 << 1) + (1 << 2) },
			},
			{
				inProgress: { $ne: 1 },
			},
		],
		hasAssignment: { $gte: 1 },
	}).exec();

	toRequestInProgress.forEach((project) => {
		projectRequestInProgressMark(project);
	});

	const maxTimeTaken = await Setting.findById('maxTimeTaken').lean().exec();
	// eslint-disable-next-line max-len
	const compareDate = new Date(Date.now() - (maxTimeTaken ? parseInt(maxTimeTaken.value, 10) : (30 * 24 * 60 * 60 * 1000)));

	const toNotifyStale = await IdLink.find({
		$or: [
			{
				status: 'Sub QC/Language QC',
				$or: [
					{
						lqcProgressStart: {
							$lt: compareDate,
						},
						inProgress: {
							$gte: (1 << 1),
						},
						hasAssignment: {
							$gte: (1 << 1),
						},
					},
					{
						sqcProgressStart: {
							$lt: compareDate,
						},
						inProgress: {
							$gte: (1 << 2),
						},
						hasAssignment: {
							$gte: (1 << 2),
						},
					},
				],
			},
			{
				progressStart: {
					$lt: compareDate,
				},
				inProgress: 1,
				hasAssignment: 1,
			},
		],
		abandoned: false,
		finished: false,
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
	});

	toNotifyStale.forEach((project) => {
		staleAnnounce(project);
	});
});
