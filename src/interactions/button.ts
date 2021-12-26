import Discord from 'discord.js';
import axios, { AxiosResponse } from 'axios';
import format from 'string-template';
import { jiraClient, logger } from '../index';
import IdLink from '../models/IdLink';
import UserInfo from '../models/UserInfo';
import checkValid from '../lib/checkValid';

const config = require('../../config.json');
const strings = require('../../strings.json');

export default async function buttonInteractionHandler(interaction: Discord.ButtonInteraction) {
	// TODO: Add interaction handlers for artist
	if (interaction.customId.startsWith('assignToMe:')) {
		if (!interaction.guild) return;
		await interaction.deferReply({ ephemeral: true });
		const issueKey = interaction.customId.split(':')[1];

		// Get jira info from the OAuth server
		const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
			params: { id: interaction.user.id },
			auth: {
				username: config.oauthServer.clientId,
				password: config.oauthServer.clientSecret,
			},
		}).catch((err) => {
			logger.info(err.response.data);
			throw new Error(err);
		}) as AxiosResponse<any>;

		// Get user doc and update with the new assigned issue.
		let userInfo = await UserInfo.findById(interaction.user.id).exec();
		if (!userInfo) {
			userInfo = new UserInfo({
				_id: interaction.user.id,
			});
		}
		userInfo.lastAssigned = new Date();
		userInfo.isAssigned = true;
		userInfo.assignedTo = issueKey;

		// Update the project info in the db
		const link = await IdLink.findOne({ discordMessageId: interaction.message.id }).lean().exec()
			.catch((err: Error) => {
				interaction.editReply(strings.assignmentFail);
				throw err;
			});
		if (!link) {
			await interaction.editReply(strings.assignmentFail);
			return;
		}

		const member = await interaction.guild.members.fetch(interaction.user.id)
			.catch((err) => {
				interaction.editReply(strings.assignmentFail);
				throw err;
			});
		if (!member) {
			await interaction.editReply(strings.interactionMemberNotFound);
			return;
		}

		// TODO: Error handling
		const issue = await jiraClient.issues.getIssue({ issueIdOrKey: issueKey });

		type JiraField = {
			value: string;
		};

		// eslint-disable-next-line max-len
		const languages = issue.fields[config.jira.fields.langs].map((language: JiraField) => language.value);
		const status = issue.fields.status.name!;

		// Check if the user can be assigned to the project at the current status
		const valid = await checkValid(member, status, languages)
			.catch((err) => {
				logger.error(err);
				interaction.editReply(strings.assignmentFail);
			});

		if (!valid) {
			await interaction.editReply(strings.assignmentNotPossible);
		} else {
			// Use Jira to assign, so the webhook gets triggered and handles the rest.
			// TODO: Error handling
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
			});
			await userInfo.save();
			await interaction.editReply(strings.assignmentSuccess);
		}
	} else if (interaction.customId.startsWith('assignLQCToMe:')) {
		if (!interaction.guild) return;
		await interaction.deferReply({ ephemeral: true });
		const issueKey = interaction.customId.split(':')[1];

		const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
			params: { id: interaction.user.id },
			auth: {
				username: config.oauthServer.clientId,
				password: config.oauthServer.clientSecret,
			},
		}).catch((err) => {
			logger.error(err.response.data);
			throw new Error(err);
		}) as AxiosResponse;

		const link = await IdLink.findOne({ discordMessageId: interaction.message.id }).lean().exec()
			.catch((err: Error) => {
				interaction.editReply(strings.assignmentFail);
				throw err;
			});
		if (!link) {
			await interaction.editReply(strings.assignmentFail);
			return;
		}

		const member = await interaction.guild.members.fetch(interaction.user.id)
			.catch((err) => {
				interaction.editReply(strings.assignmentFail);
				throw err;
			});
		if (!member) {
			await interaction.editReply(strings.interactionMemberNotFound);
			return;
		}

		// TODO: Error handling
		const issue = await jiraClient.issues.getIssue({ issueIdOrKey: issueKey });

		type JiraField = {
			value: string;
		};

		// eslint-disable-next-line max-len
		const languages = issue.fields[config.jira.fields.langs].map((language: JiraField) => language.value);

		const valid = await checkValid(member, 'Sub QC/Language QC', languages, 'lqc')
			.catch((err) => {
				logger.error(err);
				interaction.editReply(strings.assignmentFail);
			});

		if (valid) {
			// TODO: Error handling
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
			});
			await interaction.editReply(strings.assignmentSuccess);
		} else {
			await interaction.editReply(strings.assignmentNotPossible);
		}
	} else if (interaction.customId.startsWith('assignSQCToMe:')) {
		if (!interaction.guild) return;
		await interaction.deferReply({ ephemeral: true });
		const issueKey = interaction.customId.split(':')[1];

		const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
			params: { id: interaction.user.id },
			auth: {
				username: config.oauthServer.clientId,
				password: config.oauthServer.clientSecret,
			},
		}).catch((err) => {
			logger.error(err.response.data);
			throw new Error(err);
		}) as AxiosResponse;

		const link = await IdLink.findOne({ discordMessageId: interaction.message.id }).lean().exec()
			.catch((err: Error) => {
				interaction.editReply(strings.assignmentFail);
				throw err;
			});
		if (!link) {
			await interaction.editReply(strings.assignmentFail);
			return;
		}

		const member = await interaction.guild.members.fetch(interaction.user.id)
			.catch((err) => {
				interaction.editReply(strings.assignmentFail);
				throw err;
			});
		if (!member) {
			await interaction.editReply(strings.interactionMemberNotFound);
			return;
		}

		const valid = await checkValid(member, 'Sub QC/Language QC', [], 'sqc')
			.catch((err) => {
				logger.error(err);
				interaction.editReply(strings.assignmentFail);
			});

		if (valid) {
			// TODO: Error handling
			await jiraClient.issues.doTransition({
				issueIdOrKey: issueKey,
				fields: {
					[config.jira.fields.SubQCAssignee]: {
						name: user.username,
					},
				},
				transition: {
					id: config.jira.transitions['Assign SubQC'],
				},
			});
			await interaction.editReply(strings.assignmentSuccess);
		} else {
			await interaction.editReply(strings.assignmentNotPossible);
		}
		// TODO: Interaction handlers for stale and abandon
	} else if (interaction.customId.startsWith('dontStale:')) {
		await interaction.deferReply();

		const jiraKey = interaction.customId.split(':')[1];

		const user = await UserInfo.findById(interaction.user.id).exec()
			.catch((err) => {
				logger.error(err);
			});
		if (!user) {
			await interaction.editReply(strings.unknownError);
			return;
		}
		if (user.assignedTo !== jiraKey) {
			await interaction.editReply(strings.notAssignedAnymore);
			return;
		}

		const project = await IdLink.findOne({ jiraKey }).exec();
		if (!project) {
			await interaction.editReply(strings.unknownError);
			return;
		}

		if (user.assignedAs) {
			if (user.assignedAs === 'lqc') {
				if (!(project.updateRequest & (1 << 1))) {
					await interaction.editReply(strings.requestNotActive);
					return;
				}
				project.lqcLastUpdate = new Date();
				project.updateRequest -= (1 << 1);
				project.save(async (err) => {
					if (err) {
						logger.error(err);
						await interaction.editReply(strings.unknownError);
						return;
					}
					await interaction.editReply(strings.updateReceivedFromUser);
				});
			} else if (user.assignedAs === 'sqc') {
				if (!(project.updateRequest & (1 << 2))) {
					await interaction.editReply(strings.requestNotActive);
					return;
				}
				project.sqcLastUpdate = new Date();
				project.updateRequest -= (1 << 2);
				project.save(async (err) => {
					if (err) {
						logger.error(err);
						await interaction.editReply(strings.unknownError);
						return;
					}
					await interaction.editReply(strings.updateReceivedFromUser);
				});
			}
		} else {
			if (!(project.updateRequest & (1 << 0))) {
				await interaction.editReply(strings.requestNotActive);
				return;
			}
			project.sqcLastUpdate = new Date();
			project.updateRequest -= (1 << 0);
			project.save(async (err) => {
				if (err) {
					logger.error(err);
					await interaction.editReply(strings.unknownError);
					return;
				}
				await interaction.editReply(strings.updateReceivedFromUser);
			});
		}
	} else if (interaction.customId.startsWith('abandonProject:')) {
		// TODO: Error handling
		await interaction.deferReply();

		const jiraKey = interaction.customId.split(':')[1];

		const user = await UserInfo.findById(interaction.user.id).exec()
			.catch((err) => {
				logger.error(err);
			});
		if (!user) {
			await interaction.editReply(strings.unknownError);
			return;
		}

		if (user.assignedTo !== jiraKey) {
			await interaction.editReply(strings.notAssignedAnymore);
			return;
		}

		const project = await IdLink.findOne({ jiraKey }).exec();
		if (!project) {
			await interaction.editReply(strings.unknownError);
			return;
		}

		if (user.assignedAs) {
			if (user.assignedAs === 'lqc') {
				await jiraClient.issues.doTransition({
					issueIdOrKey: project.jiraKey!,
					fields: {
						[config.jira.fields.LQCAssignee]: null,
					},
					transition: {
						id: config.jira.transitions['Assign LQC'],
					},
				});

				project.staleCount += 1;
				await project.save();

				await interaction.editReply(format(strings.projectAbandoned, { jiraKey }));
			} else if (user.assignedAs === 'sqc') {
				await jiraClient.issues.doTransition({
					issueIdOrKey: project.jiraKey!,
					fields: {
						[config.jira.fields.SubQCAssignee]: null,
					},
					transition: {
						id: config.jira.transitions['Assign SubQC'],
					},
				});

				project.staleCount += 1;
				await project.save();

				await interaction.editReply(format(strings.projectAbandoned, { jiraKey }));
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
			});

			project.staleCount += 1;
			await project.save();

			await interaction.editReply(format(strings.projectAbandoned, { jiraKey }));
		}
	}
}
