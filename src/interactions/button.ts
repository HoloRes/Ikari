import Discord from 'discord.js';
import axios, { AxiosResponse } from 'axios';
import format from 'string-template';
import humanizeDuration from 'humanize-duration';
import * as Sentry from '@sentry/node';
import { jiraClient, logger } from '../index';
import IdLink from '../models/IdLink';
import UserInfo from '../models/UserInfo';
import checkValid from '../lib/checkValid';
import { allServicesOnline, updateUserGroups } from '../lib/middleware';
import Setting from '../models/Setting';
import GroupLink from '../models/GroupLink';

const config = require('../../config.json');
const strings = require('../../strings.json');

export default async function buttonInteractionHandler(interaction: Discord.ButtonInteraction) {
	const isEverythingOnline = await allServicesOnline();
	if (!isEverythingOnline) {
		await interaction.reply({ content: strings.serviceOffline, ephemeral: true });
		return;
	}

	if (interaction.customId.startsWith('assignToMe:')) {
		if (!interaction.guild) return;
		await interaction.deferReply({ ephemeral: true });
		const issueKey = interaction.customId.split(':')[1];

		let encounteredError = false;

		// Get jira info from the OAuth server
		const res = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
			params: { id: interaction.user.id },
			auth: {
				username: config.oauthServer.clientId,
				password: config.oauthServer.clientSecret,
			},
		}).catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while user from OAuth (${eventId})`);
			interaction.editReply(format(strings.assignmentFail, { eventId }));
			encounteredError = true;
		}) as AxiosResponse;
		if (encounteredError) return;

		const user = res.data;
		if (!user) {
			await interaction.editReply(format(strings.assignmentFail, { eventId: 'noDataInValidRes' }));
			return;
		}

		// Update the project info in the db
		const link = await IdLink.findOne({ discordMessageId: interaction.message.id }).lean().exec()
			.catch((err: Error) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching project link (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!link) {
			await interaction.editReply(format(strings.assignmentFail, { eventId: 'somehowNoIdLink' }));
			return;
		}

		const member = await interaction.guild.members.fetch(interaction.user.id)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching member on Discord (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!member) {
			await interaction.editReply(strings.interactionMemberNotFound);
			return;
		}

		updateUserGroups(interaction.user.id)
			.catch(() => {
				interaction.editReply(format(strings.assignmentFail, { eventId: 'updateUserGroupsFail' }));
				encounteredError = true;
			});
		if (encounteredError) return;

		const issue = await jiraClient.issues.getIssue({ issueIdOrKey: issueKey })
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching Jira issue (${eventId})`);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!issue) {
			await interaction.editReply(format(strings.assignmentFail, { eventId: 'somehowNoIssue' }));
			return;
		}

		type JiraField = {
			value: string;
		};

		// eslint-disable-next-line max-len
		const languages = issue.fields[config.jira.fields.langs].map((language: JiraField) => language.value);
		const status = issue.fields.status.name!;

		// Check if the user can be assigned to the project at the current status
		const valid = await checkValid(member, status, languages)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error checking if user is valid (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (valid) {
			// Use Jira to assign, so the webhook gets triggered and handles the rest.
			await jiraClient.issues.doTransition({
				issueIdOrKey: issueKey,
				fields: {
					assignee: {
						name: user.username,
					},
				},
				transition: {
					id: config.jira.transitions.Assign,
				},
			}).then(() => {
				interaction.editReply(strings.assignmentSuccess);
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
			});
		} else {
			await interaction.editReply(strings.assignmentNotPossible);
		}
	} else if (interaction.customId.startsWith('assignLQCToMe:')) {
		if (!interaction.guild) return;
		await interaction.deferReply({ ephemeral: true });
		const issueKey = interaction.customId.split(':')[1];

		let encounteredError = false;

		const res = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
			params: { id: interaction.user.id },
			auth: {
				username: config.oauthServer.clientId,
				password: config.oauthServer.clientSecret,
			},
		}).catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while user from OAuth (${eventId})`);
			interaction.editReply(format(strings.assignmentFail, { eventId }));
			encounteredError = true;
		}) as AxiosResponse;
		if (encounteredError) return;

		const user = res.data;
		if (!user) {
			await interaction.editReply(strings.unknownError);
			return;
		}

		const link = await IdLink.findOne({ discordMessageId: interaction.message.id }).lean().exec()
			.catch((err: Error) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching project link (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!link) {
			await interaction.editReply(format(strings.assignmentFail, { eventId: 'somehowNoIdLink' }));
			return;
		}

		const member = await interaction.guild.members.fetch(interaction.user.id)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching member on Discord (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!member) {
			await interaction.editReply(strings.interactionMemberNotFound);
			return;
		}

		updateUserGroups(interaction.user.id)
			.catch(() => {
				interaction.editReply(format(strings.assignmentFail, { eventId: 'updateUserGroupsFail' }));
				encounteredError = true;
			});
		if (encounteredError) return;

		const issue = await jiraClient.issues.getIssue({ issueIdOrKey: issueKey })
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching Jira issue (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!issue) {
			await interaction.editReply(format(strings.assignmentFail, { eventId: 'somehowNoIssue' }));
			return;
		}

		type JiraField = {
			value: string;
		};

		// eslint-disable-next-line max-len
		const languages = issue.fields[config.jira.fields.langs].map((language: JiraField) => language.value);

		const valid = await checkValid(member, 'Sub QC/Language QC', languages, 'lqc')
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error checking if user is valid (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (valid) {
			await jiraClient.issues.doTransition({
				issueIdOrKey: issueKey,
				fields: {
					[config.jira.fields.LQCAssignee]: {
						name: user.username,
					},
				},
				transition: {
					id: config.jira.transitions['Assign LQC'],
				},
			}).then(() => {
				interaction.editReply(strings.assignmentSuccess);
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
			});
		} else {
			await interaction.editReply(strings.assignmentNotPossible);
		}
	} else if (interaction.customId.startsWith('assignSQCToMe:')) {
		if (!interaction.guild) return;
		await interaction.deferReply({ ephemeral: true });
		const issueKey = interaction.customId.split(':')[1];

		let encounteredError = false;

		const res = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
			params: { id: interaction.user.id },
			auth: {
				username: config.oauthServer.clientId,
				password: config.oauthServer.clientSecret,
			},
		}).catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while user from OAuth (${eventId})`);
			interaction.editReply(format(strings.assignmentFail, { eventId }));
			encounteredError = true;
		}) as AxiosResponse;
		if (encounteredError) return;

		const user = res.data;
		if (!user) {
			await interaction.editReply(format(strings.assignmentFail, { eventId: 'somehowNoUser' }));
			return;
		}

		const link = await IdLink.findOne({ discordMessageId: interaction.message.id }).lean().exec()
			.catch((err: Error) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching project link (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!link) {
			await interaction.editReply(format(strings.assignmentFail, { eventId: 'somehowNoIdLink' }));
			return;
		}

		const member = await interaction.guild.members.fetch(interaction.user.id)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching member on Discord (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!member) {
			await interaction.editReply(strings.interactionMemberNotFound);
			return;
		}

		updateUserGroups(interaction.user.id)
			.catch(() => {
				interaction.editReply(format(strings.assignmentFail, { eventId: 'updateUserGroupsFail' }));
				encounteredError = true;
			});
		if (encounteredError) return;

		const valid = await checkValid(member, 'Sub QC/Language QC', [], 'sqc')
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error checking if user is valid (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (valid) {
			await jiraClient.issues.doTransition({
				issueIdOrKey: issueKey,
				fields: {
					[config.jira.fields.SQCAssignee]: {
						name: user.username,
					},
				},
				transition: {
					id: config.jira.transitions['Assign SQC'],
				},
			}).then(() => {
				interaction.editReply(strings.assignmentSuccess);
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
			});
		} else {
			await interaction.editReply(strings.assignmentNotPossible);
		}
	} else if (interaction.customId.startsWith('markInProgress:')) {
		await interaction.deferReply();

		const jiraKey = interaction.customId.split(':')[1];
		const maxTimeTaken = await Setting.findById('maxTimeTaken').lean().exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching setting (${eventId})`);
			});

		let encounteredError = false;

		const user = await UserInfo.findById(interaction.user.id).exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching user from db (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.unknownError, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!user) {
			await interaction.editReply(format(strings.unknownError, { eventId: 'somehowNoUserDoc' }));
			return;
		}
		if (user.assignedTo.findIndex((key) => key === jiraKey) === -1) {
			await interaction.editReply(strings.notAssignedAnymore);
			return;
		}

		const project = await IdLink.findOne({ jiraKey }).exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching id link (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.unknownError, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;
		if (!project) {
			await interaction.editReply(strings.unknownError);
			return;
		}

		if (user.assignedAs.get(jiraKey)) {
			if (user.assignedAs.get(jiraKey) === 'lqc') {
				if (project.inProgress & (1 << 1)) {
					await interaction.editReply(strings.requestNotActive);
					return;
				}
				project.lqcProgressStart = new Date();
				project.inProgress += (1 << 1);
				project.save(async (err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving id link (${eventId})`);
						logger.error(err);
						await interaction.editReply(format(strings.unknownError, { eventId }));
						return;
					}
					await interaction.editReply(format(strings.updateReceivedFromUser, {
						maxTime: humanizeDuration(
							maxTimeTaken?.value ? parseInt(maxTimeTaken.value, 10) : (30 * 24 * 60 * 60 * 1000),
							{
								largest: 1,
								units: ['m', 'd', 'h'],
								round: true,
							},
						),
					}));
				});
			} else if (user.assignedAs.get(jiraKey) === 'sqc') {
				if (project.inProgress & (1 << 2)) {
					await interaction.editReply(strings.requestNotActive);
					return;
				}
				project.sqcProgressStart = new Date();
				project.inProgress += (1 << 2);
				project.save(async (err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving id link (${eventId})`);
						logger.error(err);
						await interaction.editReply(format(strings.unknownError, { eventId }));
						return;
					}
					await interaction.editReply(format(strings.updateReceivedFromUser, {
						maxTime: humanizeDuration(
							maxTimeTaken?.value ? parseInt(maxTimeTaken.value, 10) : (30 * 24 * 60 * 60 * 1000),
							{
								largest: 1,
								units: ['m', 'd', 'h'],
								round: true,
							},
						),
					}));
				});
			}
		} else {
			if (project.inProgress & (1 << 0)) {
				await interaction.editReply(strings.requestNotActive);
				return;
			}
			project.progressStart = new Date();
			project.inProgress += (1 << 0);
			project.save(async (err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving id link (${eventId})`);
					logger.error(err);
					await interaction.editReply(format(strings.unknownError, { eventId }));
					return;
				}
				await interaction.editReply(format(strings.updateReceivedFromUser, {
					maxTime: humanizeDuration(
						maxTimeTaken?.value ? parseInt(maxTimeTaken?.value, 10) : (30 * 24 * 60 * 60 * 1000),
						{
							largest: 1,
							units: ['m', 'd', 'h'],
							round: true,
						},
					),
				}));
			});
		}
	} else if (interaction.customId.startsWith('abandonProject:')) {
		await interaction.deferReply();

		const jiraKey = interaction.customId.split(':')[1];

		let encounteredError = false;

		const user = await UserInfo.findById(interaction.user.id).exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching user from db (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.unknownError, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!user) {
			await interaction.editReply(format(strings.unknownError, { eventId: 'somehowNoUserDoc' }));
			return;
		}

		if (user.assignedTo.findIndex((key) => key === jiraKey) === -1) {
			await interaction.editReply(strings.notAssignedAnymore);
			return;
		}

		const project = await IdLink.findOne({ jiraKey }).exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching id link (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.unknownError, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!project) {
			await interaction.editReply(format(strings.unknownError, { eventId: 'somehowNoProjectDoc' }));
			return;
		}

		if (user.assignedAs.get(jiraKey)) {
			if (user.assignedAs.get(jiraKey) === 'lqc') {
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
					interaction.editReply(format(strings.unknownError, { eventId }));
				});

				project.staleCount += 1;
				project.save((err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving id link (${eventId})`);
						interaction.editReply(format(strings.unknownError, { eventId }));
					}
				});

				await interaction.editReply(format(strings.projectAbandoned, { jiraKey }));
			} else if (user.assignedAs.get(jiraKey) === 'sqc') {
				await jiraClient.issues.doTransition({
					issueIdOrKey: project.jiraKey!,
					fields: {
						[config.jira.fields.SQCAssignee]: null,
					},
					transition: {
						id: config.jira.transitions['Assign SQC'],
					},
				}).then(() => {
					project.staleCount += 1;
					project.save((err) => {
						if (err) {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while saving id link (${eventId})`);
							interaction.editReply(format(strings.unknownError, { eventId }));
							return;
						}
						interaction.editReply(format(strings.projectAbandoned, { jiraKey }));
					});
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error transitioning issue (${eventId})`);
					interaction.editReply(format(strings.unknownError, { eventId }));
				});
			}
		} else {
			await jiraClient.issues.doTransition({
				issueIdOrKey: project.jiraKey!,
				fields: {
					assignee: null,
				},
				transition: {
					id: config.jira.transitions.Assign,
				},
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
				interaction.editReply(format(strings.unknownError, { eventId }));
			});

			project.staleCount += 1;
			project.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving id link (${eventId})`);
					logger.error(err);
					interaction.editReply(format(strings.unknownError, { eventId }));
				}
			});

			await interaction.editReply(format(strings.projectAbandoned, { jiraKey }));

			await jiraClient.issueComments.addComment({
				issueIdOrKey: project.jiraKey!,
				body: `Project has been abandoned, stale count is now ${project.staleCount}/3`,
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while adding comment on Jira (${eventId})`);
			});
		}
	} else if (interaction.customId.startsWith('teamLead:')) {
		if (!interaction.guild) return;
		await interaction.deferReply();

		let encounteredError = false;

		const teamLeadRole = await GroupLink.findOne({ jiraName: 'Team Lead' }).lean().exec()
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching group link (${eventId})`);
			});

		if (!teamLeadRole) {
			await interaction.editReply('No team lead role found, please report this.');
			return;
		}
		const member = await interaction.guild.members.fetch(interaction.user.id)
			.catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching user on Discord (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.unknownError, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!member) {
			await interaction.editReply(strings.interactionMemberNotFound);
			return;
		}
		if (!member.roles.cache.has(teamLeadRole._id)) {
			await interaction.editReply('You don\'t have permission to execute this.');
			return;
		}

		const command = interaction.customId.substring('teamLead:'.length);
		if (command.startsWith('artist:')) {
			const subcommand = command.substring('artist:'.length);
			if (subcommand.startsWith('abandonProject:')) {
				const issueKey = subcommand.split(':')[1];

				await jiraClient.issues.doTransition({
					issueIdOrKey: issueKey,
					transition: {
						id: config.jira.artist.transitions['Abandon Project'],
					},
				}).then(() => {
					interaction.editReply('Abandoned project, this is irreversible!');
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error transitioning issue (${eventId})`);
					interaction.editReply(format(strings.unknownError, { eventId }));
				});
			} else if (subcommand.startsWith('unassign:')) {
				const issueKey = subcommand.split(':')[1];

				await jiraClient.issues.doTransition({
					issueIdOrKey: issueKey,
					fields: {
						assignee: null,
					},
					transition: {
						id: config.jira.artist.transitions.Assign,
					},
				}).then(() => {
					interaction.editReply('Unassigned project');
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error transitioning issue (${eventId})`);
					interaction.editReply(format(strings.assignmentFail, { eventId }));
				});
			}
		} else if (command.startsWith('abandonProject:')) {
			const issueKey = command.split(':')[1];

			await jiraClient.issues.doTransition({
				issueIdOrKey: issueKey,
				transition: {
					id: config.jira.transitions['Abandon Project'],
				},
			}).then(() => {
				interaction.editReply('Abandoned project, this is irreversible!');
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
				interaction.editReply(format(strings.unknownError, { eventId }));
			});
		} else if (command.startsWith('unassign:')) {
			const issueKey = command.split(':')[1];

			await jiraClient.issues.doTransition({
				issueIdOrKey: issueKey,
				fields: {
					assignee: null,
				},
				transition: {
					id: config.jira.transitions.Assign,
				},
			}).then(() => {
				interaction.editReply('Unassigned project');
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
			});
		} else if (command.startsWith('unassign-lqc:')) {
			const issueKey = command.split(':')[1];

			await jiraClient.issues.doTransition({
				issueIdOrKey: issueKey,
				fields: {
					[config.jira.fields.LQCAssignee]: null,
				},
				transition: {
					id: config.jira.transitions['Assign LQC'],
				},
			}).then(async () => {
				await interaction.editReply(strings.assignmentSuccess);
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
			});
		} else if (command.startsWith('unassign-sqc:')) {
			const issueKey = command.split(':')[1];

			await jiraClient.issues.doTransition({
				issueIdOrKey: issueKey,
				fields: {
					[config.jira.fields.SQCAssignee]: null,
				},
				transition: {
					id: config.jira.transitions['Assign SQC'],
				},
			}).then(async () => {
				await interaction.editReply(strings.assignmentSuccess);
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
			});
		}
	} else if (interaction.customId.startsWith('artist:')) {
		const command = interaction.customId.substring('artist:'.length);

		if (command.startsWith('assignToMe:')) {
			if (!interaction.guild) return;
			await interaction.deferReply({ ephemeral: true });
			const issueKey = command.split(':')[1];

			let encounteredError = false;

			// Get jira info from the OAuth server
			const res = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
				params: { id: interaction.user.id },
				auth: {
					username: config.oauthServer.clientId,
					password: config.oauthServer.clientSecret,
				},
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while user from OAuth (${eventId})`);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			}) as AxiosResponse;
			if (encounteredError) return;

			const user = res.data;
			if (!user) {
				await interaction.editReply(format(strings.assignmentFail, { eventId: 'noDataInValidRes' }));
				return;
			}

			// Update the project info in the db
			const link = await IdLink.findOne({ discordMessageId: interaction.message.id }).lean().exec()
				.catch((err: Error) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching project link (${eventId})`);
					logger.error(err);
					interaction.editReply(format(strings.assignmentFail, { eventId }));
					encounteredError = true;
				});
			if (encounteredError) return;

			if (!link) {
				await interaction.editReply(format(strings.assignmentFail, { eventId: 'somehowNoIdLink' }));
				return;
			}

			const member = await interaction.guild.members.fetch(interaction.user.id)
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching member on Discord (${eventId})`);
					logger.error(err);
					interaction.editReply(format(strings.assignmentFail, { eventId }));
					encounteredError = true;
				});
			if (encounteredError) return;

			if (!member) {
				await interaction.editReply(strings.interactionMemberNotFound);
				return;
			}

			updateUserGroups(interaction.user.id)
				.catch(() => {
					interaction.editReply(format(strings.assignmentFail, { eventId: 'updateUserGroupsFail' }));
					encounteredError = true;
				});
			if (encounteredError) return;

			const issue = await jiraClient.issues.getIssue({ issueIdOrKey: issueKey })
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching Jira issue (${eventId})`);
					logger.error(err);
					interaction.editReply(format(strings.assignmentFail, { eventId }));
					encounteredError = true;
				});
			if (encounteredError) return;

			if (!issue) {
				await interaction.editReply(format(strings.assignmentFail, { eventId: 'somehowNoUser' }));
				return;
			}

			const artistRoleDoc = await GroupLink.findOne({ jiraName: 'Artist' })
				.exec()
				.catch((err: Error) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching group link (${eventId})`);
					logger.error(err);
					interaction.editReply(format(strings.assignmentFail, { eventId }));
					encounteredError = true;
				});
			if (encounteredError) return;

			const valid = member.roles.cache.has(artistRoleDoc!._id);

			if (valid) {
				// Use Jira to assign, so the webhook gets triggered and handles the rest.
				await jiraClient.issues.doTransition({
					issueIdOrKey: issueKey,
					fields: {
						assignee: {
							name: user.username,
						},
					},
					transition: {
						id: config.jira.artist.transitions.Assign,
					},
				}).then(() => {
					interaction.editReply(strings.assignmentSuccess);
				}).catch((err) => {
					const eventId = Sentry.captureException(err);
					console.error(err);
					logger.error(`Encountered error transitioning issue (${eventId})`);
					interaction.editReply(format(strings.assignmentFail, { eventId }));
				});
			} else {
				await interaction.editReply(strings.assignmentNotPossible);
			}
		} else if (command.startsWith('abandonProject:')) {
			await interaction.deferReply();

			const jiraKey = command.split(':')[1];

			let encounteredError = false;

			const user = await UserInfo.findById(interaction.user.id).exec()
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from db (${eventId})`);
					logger.error(err);
					interaction.editReply(format(strings.unknownError, { eventId }));
					encounteredError = true;
				});
			if (encounteredError) return;

			if (!user) {
				await interaction.editReply(format(strings.unknownError, { eventId: 'somehowNoUserDoc' }));
				return;
			}

			if (user.assignedTo.findIndex((key) => key === jiraKey) === -1) {
				await interaction.editReply(strings.notAssignedAnymore);
				return;
			}

			const project = await IdLink.findOne({ jiraKey }).exec()
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching id link (${eventId})`);
					logger.error(err);
					interaction.editReply(format(strings.unknownError, { eventId }));
					encounteredError = true;
				});
			if (encounteredError) return;

			if (!project) {
				await interaction.editReply(format(strings.unknownError, { eventId: 'somehowNoProjectDoc' }));
				return;
			}

			await jiraClient.issues.doTransition({
				issueIdOrKey: project.jiraKey!,
				fields: {
					assignee: null,
				},
				transition: {
					id: config.jira.artist.transitions.Assign,
				},
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error transitioning issue (${eventId})`);
				interaction.editReply(format(strings.unknownError, { eventId }));
			});

			project.staleCount += 1;
			project.save((err) => {
				if (err) {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while saving id link (${eventId})`);
					logger.error(err);
					interaction.editReply(format(strings.unknownError, { eventId }));
				}
			});

			await interaction.editReply(format(strings.projectAbandoned, { jiraKey }));

			await jiraClient.issueComments.addComment({
				issueIdOrKey: project.jiraKey!,
				body: `Project has been abandoned, stale count is now ${project.staleCount}/3`,
			}).catch((err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while adding comment on Jira (${eventId})`);
			});
		}
	}
}
