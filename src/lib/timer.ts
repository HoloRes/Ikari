import axios from 'axios';
import format from 'string-template';
import { Document } from 'mongoose';
import Discord, {
	MessageActionRow, MessageButton, MessageEmbed, TextChannel,
} from 'discord.js';
import humanizeDuration from 'humanize-duration';
import cron from 'node-cron';
import * as Sentry from '@sentry/node';
import IdLink, { Project } from '../models/IdLink';
import GroupLink from '../models/GroupLink';
import UserInfo from '../models/UserInfo';
import { client, jiraClient, logger } from '../index';
import checkValid from './checkValid';
import Setting from '../models/Setting';
import { allServicesOnline } from './middleware';
import StatusLink from '../models/StatusLink';

const config = require('../../config.json');
const strings = require('../../strings.json');

// eslint-disable-next-line max-len
const asyncFilter = async <T>(arr: T[], predicate: (item: T, index?: number, array?: T[]) => Promise<boolean>): Promise<T[]> => Promise.all(arr.map(predicate))
	.then((results) => arr.filter((_v, index) => results[index]));

async function autoAssign(project: Project, role?: 'sqc' | 'lqc'): Promise<void> {
	logger.verbose(`Auto assigning ${project.jiraKey}`);
	let encounteredError = false;

	const hiatusRole = await GroupLink.findOne({ jiraName: 'Hiatus' }).exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching hiatus group link (${eventId})`);
		});

	const available = await UserInfo.find({
		roles: {
			// Set to something impossible when the hiatus role cannot be found
			$ne: hiatusRole?._id ?? '0000',
		},
		isAssigned: false,
	}).sort({ lastAssigned: 'desc' }).exec().catch((err) => {
		const eventId = Sentry.captureException(err);
		logger.error(`Encountered error while fetching project link (${eventId})`);
		logger.error(err);
		encounteredError = true;
	});
	if (encounteredError || !available) return;

	if (available.length === 0) {
		logger.info(`Somehow, there's no one available for: ${project.jiraKey} ${role ? `(${role})` : ''}`);
		return;
	}

	const guild = await client.guilds.fetch(config.discord.guild)
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching guild from Discord (${eventId})`);
			logger.error(err);
			encounteredError = true;
		});
	if (encounteredError || !guild) return;

	let filteredAvailable;

	try {
		filteredAvailable = await asyncFilter<any>(available, async (user) => {
			const member = await guild.members.fetch(user._id)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from Discord (${eventId})`);
					logger.error(err);
				});
			if (!member) return false;
			return checkValid(member, project.status, project.languages, role);
		});
		/* filteredAvailable = available.filter(async (user) => {
			const member = await guild.members.fetch(user._id)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from Discord (${eventId})`);
					logger.error(err);
				});
			if (!member) return false;
			return checkValid(member, project.status, project.languages, role);
		}); */
	} catch (err) {
		const eventId = Sentry.captureException(err);
		logger.error(`Encountered error while filtering available users (${eventId})`);
		logger.error(err);
		return;
	}

	if (filteredAvailable?.length === 0) {
		logger.info(`Somehow, there's no one available for: ${project.jiraKey}`);
		return;
	}

	const res = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
		params: { id: filteredAvailable[0]._id },
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
	const user = res!.data;

	const discordUser = await client.users.fetch(filteredAvailable[0]._id)
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching user on Discord (${eventId})`);
			logger.error(err);
			encounteredError = true;
		});
	if (encounteredError || !discordUser) return;

	// Role is only set in SQC/LQC status
	if (role) {
		if (role === 'sqc') {
			await jiraClient.issues.doTransition({
				issueIdOrKey: project.jiraKey!,
				fields: {
					[config.jira.fields.SQCAssignee]: {
						name: user.username,
					},
				},
				transition: {
					id: config.jira.transitions['Assign SQC'],
				},
			}).then(async () => {
				await discordUser.send(format(strings.autoAssignedTo, { jiraKey: project.jiraKey }))
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error sending message (${eventId})`);
						logger.error(err);
					});
				await jiraClient.issueComments.addComment({
					issueIdOrKey: project.jiraKey!,
					body: `Auto assigned SQC to [~${user.username}].`,
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while adding comment on Jira (${eventId})`);
				});
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				console.error(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
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
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while adding comment on Jira (${eventId})`);
				});
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				console.error(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
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
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while adding comment on Jira (${eventId})`);
			});
		}).catch((err) => {
			const eventId = Sentry.captureException(err);
			console.error(err);
			logger.error(`Encountered error transitioning issue (${eventId})`);
		});
	}
}

async function autoAssignArtist(project: Document<any, any, Project> & Project) {
	logger.verbose(`Auto assigning ${project.jiraKey} (artist)`);
	let encounteredError = false;

	const hiatusRole = await GroupLink.findOne({ jiraName: 'Hiatus' }).exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching hiatus group link (${eventId})`);
		});

	const artistRole = await GroupLink.findOne({ jiraName: 'Artist' }).exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching artist group link (${eventId})`);
		});

	if (!artistRole) {
		logger.warn('No artist role found');
		return;
	}

	const available = await UserInfo.find({
		roles: {
			// Set to something impossible when the hiatus role cannot be found
			$ne: hiatusRole?._id ?? '0000',
		},
		isAssigned: false,
	}).sort({ lastAssigned: 'desc' }).exec().catch((err) => {
		const eventId = Sentry.captureException(err);
		logger.error(`Encountered error while fetching project link (${eventId})`);
		logger.error(err);
		encounteredError = true;
	});
	if (encounteredError || !available) return;

	const guild = await client.guilds.fetch(config.discord.guild)
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching guild from Discord (${eventId})`);
			logger.error(err);
			encounteredError = true;
		});
	if (encounteredError) return;

	if (!guild) return;
	if (available.length === 0) {
		logger.info(`Somehow, there's no one available for: ${project.jiraKey}`);
		return;
	}

	let filteredAvailable;
	try {
		filteredAvailable = await asyncFilter<any>(available, async (user) => {
			const member = await guild.members.fetch(user._id)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from Discord (${eventId})`);
					logger.error(err);
				});
			if (!member) return false;
			return member.roles.cache.has(artistRole._id);
		});

		/* filteredAvailable = available.filter(async (user) => {
			const member = await guild.members.fetch(user._id)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from Discord (${eventId})`);
					logger.error(err);
				});
			if (!member) return false;
			return member.roles.cache.has(artistRole._id);
		}); */
	} catch (err) {
		const eventId = Sentry.captureException(err);
		logger.error(`Encountered error while filtering available users (${eventId})`);
		logger.error(err);
		return;
	}
	console.log(filteredAvailable);

	if (filteredAvailable?.length === 0) {
		logger.info(`Somehow, there's no one available for: ${project.jiraKey}`);
		return;
	}

	const res = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
		params: { id: filteredAvailable[0]._id },
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
	const user = res!.data;

	const discordUser = await client.users.fetch(filteredAvailable[0]._id)
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching user on Discord (${eventId})`);
			logger.error(err);
			encounteredError = true;
		});
	if (encounteredError || !discordUser) return;

	await jiraClient.issues.doTransition({
		issueIdOrKey: project.jiraKey!,
		fields: {
			assignee: {
				name: user.username,
			},
		},
		transition: {
			id: config.jira.artist.transitions.Assign,
		},
	}).then(async () => {
		await discordUser.send(format(strings.autoAssignedTo, { jiraKey: project.jiraKey }));
		await jiraClient.issueComments.addComment({
			issueIdOrKey: project.jiraKey!,
			body: `Auto assigned project to [~${user.username}].`,
		}).catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while adding comment on Jira (${eventId})`);
		});
	}).catch((err) => {
		const eventId = Sentry.captureException(err);
		console.error(err);
		logger.error(`Encountered error transitioning issue (${eventId})`);
	});
}

async function projectRequestInProgressMark(project: Document<any, any, Project> & Project) {
	let encounteredError = false;

	const repeatRequestAfter = await Setting.findById('repeatRequestAfter').lean().exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching setting (${eventId})`);
		});

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
			}).exec().catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching user doc (${eventId})`);
				logger.error(err);
				encounteredError = true;
			});
			if (encounteredError) return;

			if (user && (user.updateRequested.get(project.jiraKey!)! < compareDate)) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching user on Discord(${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (discordUser) {
					const updateRequestCount = user.updateRequestCount.get(project.jiraKey!) ?? 0;

					if (updateRequestCount === 3) {
						await jiraClient.issues.doTransition({
							issueIdOrKey: project.jiraKey!,
							fields: {
								[config.jira.fields.LQCAssignee]: null,
							},
							transition: {
								id: config.jira.transitions['Assign LQC'],
							},
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error transitioning issue (${eventId})`);
						});

						const res = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
							params: { id: discordUser.id },
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
						const jiraUser = res!.data;

						/* eslint-disable no-param-reassign */
						project.staleCount += 1;
						/* eslint-enable */
						project.save(async (err) => {
							if (err) {
								const eventId = Sentry.captureException(err);
								logger.error(`Encountered error while saving issue link (${eventId})`);
								logger.error(err);
								return;
							}

							await discordUser.send(format(strings.noUpdateInTime, { jiraKey: project.jiraKey! }))
								.catch((e) => {
									const eventId = Sentry.captureException(e);
									logger.error(`Encountered error while sending message (${eventId})`);
									logger.error(e);
								});

							await jiraClient.issueComments.addComment({
								issueIdOrKey: project.jiraKey!,
								body: `Did not receive an update in time from [~${jiraUser.username}], automatically un-assigning.`,
							}).catch((e) => {
								const eventId = Sentry.captureException(e);
								logger.error(`Encountered error while adding comment on Jira (${eventId})`);
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

					if (updateRequestCount === 2) embed.setDescription(format(strings.lastUpdateUpdateRequest, { time: `<t:${Math.floor(new Date(Date.now() + (repeatRequestAfter ? parseInt(repeatRequestAfter.value, 10) : 4 * 24 * 60 * 60 * 1000)).getTime() / 1000)}:R>` }));

					await discordUser.send({ embeds: [embed], components: [componentRow] })
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error sending message (${eventId})`);
							logger.error(err);
						});

					user.updateRequested.set(project.jiraKey!, new Date());
					user.updateRequestCount.set(project.jiraKey!, updateRequestCount + 1);

					await user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user doc (${eventId})`);
							logger.error(err);
						}
					});

					await jiraClient.issueComments.addComment({
						issueIdOrKey: project.jiraKey!,
						body: 'Project has not been marked in progress yet, asking again.',
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while adding comment on Jira (${eventId})`);
					});
				}
			}
		}
		if (!(project.inProgress & (1 << 2))) {
			const user = await UserInfo.findOne({
				isAssigned: true,
				assignedTo: project.jiraKey,
				assignedAs: 'sqc',
			}).exec().catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching user doc (${eventId})`);
				logger.error(err);
				encounteredError = true;
			});
			if (encounteredError) return;

			if (user && (user.updateRequested.get(project.jiraKey!)! < compareDate)) {
				const discordUser = await client.users.fetch(user._id)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching user on Discord(${eventId})`);
						logger.error(err);
						encounteredError = true;
					});
				if (encounteredError) return;

				if (discordUser) {
					const updateRequestCount = user.updateRequestCount.get(project.jiraKey!) ?? 0;

					if (updateRequestCount === 3) {
						await jiraClient.issues.doTransition({
							issueIdOrKey: project.jiraKey!,
							fields: {
								[config.jira.fields.SQCAssignee]: null,
							},
							transition: {
								id: config.jira.transitions['Assign SQC'],
							},
						}).catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error transitioning issue (${eventId})`);
						});

						const res = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
							params: { id: discordUser.id },
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
						const jiraUser = res!.data;

						/* eslint-disable no-param-reassign */
						project.staleCount += 1;
						/* eslint-enable */
						project.save(async (err) => {
							if (err) {
								const eventId = Sentry.captureException(err);
								logger.error(`Encountered error while saving issue link (${eventId})`);
								logger.error(err);
								return;
							}

							await discordUser.send(format(strings.noUpdateInTime, { jiraKey: project.jiraKey! }))
								.catch((e) => {
									const eventId = Sentry.captureException(e);
									logger.error(`Encountered error while sending message (${eventId})`);
								});

							await jiraClient.issueComments.addComment({
								issueIdOrKey: project.jiraKey!,
								body: `Did not receive an update in time from [~${jiraUser.username}], automatically un-assigning.`,
							}).catch((e) => {
								const eventId = Sentry.captureException(e);
								logger.error(`Encountered error while adding comment on Jira (${eventId})`);
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

					if (updateRequestCount === 2) embed.setDescription(format(strings.lastUpdateUpdateRequest, { time: `<t:${Math.floor(new Date(Date.now() + (repeatRequestAfter ? parseInt(repeatRequestAfter.value, 10) : 4 * 24 * 60 * 60 * 1000)).getTime() / 1000)}:R>` }));

					await discordUser.send({ embeds: [embed], components: [componentRow] });
					user.updateRequested.set(project.jiraKey!, new Date());
					user.updateRequestCount.set(project.jiraKey!, updateRequestCount + 1);

					await user.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving user doc (${eventId})`);
							logger.error(err);
						}
					});

					await jiraClient.issueComments.addComment({
						issueIdOrKey: project.jiraKey!,
						body: 'Project has not been marked in progress yet, asking again.',
					}).catch((e) => {
						const eventId = Sentry.captureException(e);
						logger.error(`Encountered error while adding comment on Jira (${eventId})`);
					});
				}
			}
		}
	} else {
		const user = await UserInfo.findOne({
			isAssigned: true,
			assignedTo: project.jiraKey,
		}).exec().catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching user doc (${eventId})`);
			logger.error(err);
			encounteredError = true;
		});
		if (encounteredError) return;

		if (user && (user.updateRequested.get(project.jiraKey!)! < compareDate)) {
			const discordUser = await client.users.fetch(user._id)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user on Discord(${eventId})`);
					logger.error(err);
					encounteredError = true;
				});
			if (encounteredError) return;

			if (discordUser) {
				const updateRequestCount = user.updateRequestCount.get(project.jiraKey!) ?? 0;

				if (updateRequestCount === 3) {
					await jiraClient.issues.doTransition({
						issueIdOrKey: project.jiraKey!,
						fields: {
							assignee: null,
						},
						transition: {
							id: project.type === 'translation' ? config.jira.transitions.Assign : config.jira.artist.transitions.Assign,
						},
					}).catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error transitioning issue (${eventId})`);
					});

					const res = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
						params: { id: discordUser.id },
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
					const jiraUser = res!.data;

					/* eslint-disable no-param-reassign */
					project.staleCount += 1;
					/* eslint-enable */
					project.save(async (err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving issue link (${eventId})`);
							logger.error(err);
							return;
						}

						await discordUser.send(format(strings.noUpdateInTime, { jiraKey: project.jiraKey! }))
							.catch((e) => {
								const eventId = Sentry.captureException(e);
								logger.error(`Encountered error while sending message (${eventId})`);
							});

						await jiraClient.issueComments.addComment({
							issueIdOrKey: project.jiraKey!,
							body: `Did not receive an update in time from [~${jiraUser.username}], automatically un-assigning.`,
						}).catch((e) => {
							const eventId = Sentry.captureException(e);
							logger.error(`Encountered error while adding comment on Jira (${eventId})`);
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
							.setCustomId(`${project.type === 'artist' ? 'artist:' : ''}abandonProject:${project.jiraKey}`)
							.setLabel('Abandon project'),
					);

				if (updateRequestCount === 2) embed.setDescription(format(strings.lastUpdateUpdateRequest, { time: `<t:${Math.floor(new Date(Date.now() + (repeatRequestAfter ? parseInt(repeatRequestAfter.value, 10) : 4 * 24 * 60 * 60 * 1000)).getTime() / 1000)}:R>` }));

				await discordUser.send({ embeds: [embed], components: [componentRow] })
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error sending message (${eventId})`);
						logger.error(err);
					});

				user.updateRequested.set(project.jiraKey!, new Date());
				user.updateRequestCount.set(project.jiraKey!, updateRequestCount + 1);

				await user.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving user doc (${eventId})`);
						logger.error(err);
					}
				});

				await jiraClient.issueComments.addComment({
					issueIdOrKey: project.jiraKey!,
					body: 'Project has not been marked in progress yet, asking again.',
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while adding comment on Jira (${eventId})`);
				});
			}
		}
	}
	await project.save((err) => {
		if (err) {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while saving issue link (${eventId})`);
			logger.error(err);
		}
	});
}

async function staleAnnounce(project: Document<any, any, Project> & Project) {
	const teamLeadNotifySetting = await Setting.findById('teamLeadNotifyChannel').lean().exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching setting (${eventId})`);
		});

	const maxTimeTaken = await Setting.findById('maxTimeTaken').lean().exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching setting (${eventId})`);
		});

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
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching Discord channel (${eventId})`);
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
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while adding comment on Jira (${eventId})`);
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
				body: `SQC hasn't finished in ${maxTimeStr}, reporting to team leads.`,
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while adding comment on Jira (${eventId})`);
			});

			componentRow.addComponents(
				new MessageButton()
					.setStyle('PRIMARY')
					.setCustomId(`teamLead:unassign-sqc:${project.jiraKey}`)
					.setLabel('Un-assign SQC'),
			);
		}
		if (componentRow.components.length > 1) {
			await channel.send({
				content: `LQC and/or SQC hasn't finished ${project.jiraKey} in ${maxTimeStr}, please take action`,
				components: [componentRow],
			}).then(async () => {
				// eslint-disable-next-line no-param-reassign
				project.requestedTeamLeadAction = true;
				await project.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving issue link (${eventId})`);
						logger.error(err);
					}
				});
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while sending message (${eventId})`);
				logger.error(err);
			});
		}
	} else if (!project.requestedTeamLeadAction) {
		const componentRow = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setStyle('DANGER')
					.setCustomId(`teamLead:${project.type === 'artist' ? 'artist:' : ''}abandonProject:${project.jiraKey}`)
					.setLabel('Abandon project'),
				new MessageButton()
					.setStyle('PRIMARY')
					.setCustomId(`teamLead:${project.type === 'artist' ? 'artist:' : ''}unassign:${project.jiraKey}`)
					.setLabel('Un-assign project'),
			);

		await jiraClient.issueComments.addComment({
			issueIdOrKey: project.jiraKey!,
			body: `Project hasn't transitioned in ${maxTimeStr}, reporting to team leads.`,
		}).catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while adding comment on Jira (${eventId})`);
		});

		await channel.send({
			content: `Assigned person hasn't finished ${project.jiraKey} in ${maxTimeStr}, please take action`,
			components: [componentRow],
		}).then(async () => {
			// eslint-disable-next-line no-param-reassign
			project.requestedTeamLeadAction = true;
			await project.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving issue link (${eventId})`);
					logger.error(err);
				}
			});
		});
	}
}

async function unmuteProject(project: Document<any, any, Project> & Project): Promise<void> {
	let encounteredError = false;

	const channelLink = await StatusLink.findById(project.status).lean().exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching statuslink (${eventId})`);
			encounteredError = true;
		});
	if (encounteredError || !channelLink) return;

	const channel = await client.channels.fetch(channelLink.channel)
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching channel on Discord (${eventId})`);
			encounteredError = true;
		});
	if (encounteredError) return;

	if (channel?.type !== 'GUILD_TEXT') {
		logger.error(`Channel: ${channelLink.channel} is not a guild text channel`);
		return;
	}

	if (project.discordMessageId) {
		const msg = await channel.messages.fetch(project.discordMessageId)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching message (${eventId})`);
				logger.error('%o', err);
			});
		await msg?.delete()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while deleting message (${eventId})`);
				logger.error('%o', err);
			});
	}

	const issue = await jiraClient.issues.getIssue({
		issueIdOrKey: project.jiraKey!,
	});

	let user: any | undefined;
	if (issue.fields.assignee !== null) {
		const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
			params: { key: issue.fields.assignee.key },
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
		encounteredError = false;
	}

	let row: Discord.MessageActionRow;
	let embed: MessageEmbed;

	if (project.status === 'Sub QC/Language QC') {
		row = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setCustomId(`assignLQCToMe:${issue.key}`)
					.setLabel('Assign LQC to me')
					.setStyle('SUCCESS')
					.setEmoji('819518919739965490')
					.setDisabled(issue.fields[config.jira.fields.LQCAssignee] !== null),
			).addComponents(
				new MessageButton()
					.setCustomId(`assignSQCToMe:${issue.key}`)
					.setLabel('Assign SQC to me')
					.setStyle('SUCCESS')
					.setEmoji('819518919739965490')
					.setDisabled(issue.fields[config.jira.fields.SQCAssignee] !== null),
			);

		let LQCAssignee = 'Unassigned';
		let SubQCAssignee = 'Unassigned';

		if (issue.fields[config.jira.fields.LQCAssignee] !== null) {
			const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
				params: { key: issue.fields[config.jira.fields.LQCAssignee].key },
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
		if (issue.fields[config.jira.fields.SQCAssigneeS] !== null) {
			const oauthUserRes = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
				params: { key: issue.fields[config.jira.fields.SQCAssignee].key },
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

		embed = new MessageEmbed()
			.setTitle(issue.key!)
			.setColor('#0052cc')
			.setDescription(issue.fields.summary ?? 'No description available')
			.addField('Status', issue.fields.status.name!)
			.addField('LQC Assignee', LQCAssignee, true)
			.addField('SQC Assignee', SubQCAssignee, true)
			.addField(
				'LQC Status',
				(
					// eslint-disable-next-line no-nested-ternary
					(issue.fields[config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'LQC_done') ? 'Done' : (
						issue.fields[config.jira.fields.LQCAssignee] === null ? 'To do' : 'In progress'
					) ?? 'To do'
				),
			)
			.addField(
				'SQC Status',
				(
					// eslint-disable-next-line no-nested-ternary
					(issue.fields[config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'Sub_QC_done') ? 'Done' : (
						issue.fields[config.jira.fields.SQCAssignee] === null ? 'To do' : 'In progress'
					) ?? 'To do'
				),
			)
			.addField('Source', `[link](${issue.fields[config.jira.fields.videoLink]})`)
			.setFooter({ text: `Due date: ${issue.fields.duedate || 'unknown'}` })
			.setURL(`${config.jira.url}/projects/${issue.fields.project.key}/issues/${issue.key}`);
	} else {
		embed = new MessageEmbed()
			.setTitle(`${issue.key}: ${issue.fields.summary}`)
			.setColor('#0052cc')
			.setDescription(issue.fields.description ?? 'No description available')
			.addField('Status', issue.fields.status.name!)
			// eslint-disable-next-line no-nested-ternary
			.addField('Assignee', (user ? `<@${user._id}>` : (encounteredError ? '(Encountered error)' : 'Unassigned')))
			.addField('Source', `[link](${issue.fields[config.jira.fields.videoLink]})`)
			.setFooter({ text: `Due date: ${issue.fields.duedate ?? 'unknown'}` })
			.setURL(`${config.jira.url}/projects/${issue.fields.project.key}/issues/${issue.key}`);

		row = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setCustomId(`assignToMe:${issue.key}`)
					.setLabel('Assign to me')
					.setStyle('SUCCESS')
					.setEmoji('819518919739965490')
					.setDisabled(issue.fields.assignee !== null),
			);
	}

	const msg = await channel.send({ embeds: [embed], components: [row] })
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while sending message (${eventId})`);
			logger.error('%o', err);
			encounteredError = true;
		});
	if (encounteredError || !msg) return;

	/* eslint-disable no-param-reassign */
	project.discordMessageId = msg.id;
	project.mutedUntil = undefined;

	// Reset progress
	if (project.inProgress & (1 << 0)) {
		project.progressStart = new Date();
	}
	if (project.inProgress & (1 << 1)) {
		project.lqcProgressStart = new Date();
	}
	if (project.inProgress & (1 << 2)) {
		project.sqcProgressStart = new Date();
	}
	/* eslint-enable */

	await project.save(async (err) => {
		if (err) {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while saving issue link (${eventId})`);
			logger.error(err);

			await msg?.delete()
				.catch((msgErr) => {
					const msgEventId = Sentry.captureException(msgErr);
					logger.error(`Encountered error while deleting message (${msgEventId})`);
					logger.error('%o', msgErr);
				});
		}
	});
}

cron.schedule('*/5 * * * *', async () => {
	if (!await allServicesOnline()) {
		logger.info('Unable to execute timer, a service is offline!');
		return;
	}

	// Auto assign stuff
	const autoAssignAfter = await Setting.findById('autoAssignAfter').lean().exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching setting (${eventId})`);
		});

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
					type: 'translation',
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
		mutedUntil: undefined,
		lastUpdate: {
			$lte: new Date(Date.now() - (
				autoAssignAfter ? parseInt(autoAssignAfter.value, 10) : (3 * 24 * 3600 * 1000))),
		},
	}).exec().catch((err) => {
		const eventId = Sentry.captureException(err);
		logger.error(`Encountered error while fetching docs (autoassign) (${eventId})`);
		logger.error(err);
	});

	toAutoAssign?.forEach((project) => {
		if (project.status === 'Sub QC/Language QC') {
			if (!(project.hasAssignment & (1 << 1))) {
				autoAssign(project, 'lqc');
			}
			if (!(project.hasAssignment & (1 << 2))) {
				autoAssign(project, 'sqc');
			}
		} else if (project.type === 'artist') {
			autoAssignArtist(project);
		} else {
			autoAssign(project);
		}
	});

	// Progress request
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
		abandoned: false,
		finished: false,
		mutedUntil: undefined,
	}).exec().catch((err) => {
		const eventId = Sentry.captureException(err);
		logger.error(`Encountered error while fetching docs (requestInProgress) (${eventId})`);
		logger.error(err);
	});

	toRequestInProgress?.forEach((project) => {
		projectRequestInProgressMark(project);
	});

	// Stale checking
	const maxTimeTaken = await Setting.findById('maxTimeTaken').lean().exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching setting (maxTimeTaken), falling back to default value (${eventId})`);
			logger.error(err);
		});
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
		mutedUntil: undefined,
		$not: {
			$or: [
				// Ignore certain statuses and projects that do not have a message in Discord
				{
					status: 'Open',
					type: 'translation',
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
	}).exec().catch((err) => {
		const eventId = Sentry.captureException(err);
		logger.error(`Encountered error while fetching docs (notifyStale) (${eventId})`);
		logger.error(err);
	});

	toNotifyStale?.forEach((project) => {
		staleAnnounce(project);
	});
});

// Mute timer, should be run every 1-5 minutes.
cron.schedule('*/5 * * * *', async () => {
	if (!await allServicesOnline()) {
		logger.info('Unable to execute timer, a service is offline!');
		return;
	}

	const toUnmute = await IdLink.find({
		abandoned: false,
		finished: false,
		mutedUntil: {
			$lte: new Date(),
		},
	}).exec().catch((err) => {
		const eventId = Sentry.captureException(err);
		logger.error(`Encountered error while fetching docs (requestInProgress) (${eventId})`);
		logger.error(err);
	});

	toUnmute?.forEach((project) => {
		unmuteProject(project);
	});
});
