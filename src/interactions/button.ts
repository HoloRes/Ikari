import Discord from 'discord.js';
import axios, { AxiosResponse } from 'axios';
import { jiraClient, logger } from '../index';
import IdLink from '../models/IdLink';
import UserInfo from '../models/UserInfo';
import checkValid from '../lib/checkValid';

const config = require('../../config.json');
const strings = require('../../strings.json');

export default async function buttonInteractionHandler(interaction: Discord.ButtonInteraction) {
	if (!interaction.guild) return;

	// TODO: Add interaction handlers for artist
	if (interaction.customId.startsWith('assignToMe:')) {
		await interaction.deferReply({ ephemeral: true });
		const issueKey = interaction.customId.split(':')[1];

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

		let userInfo = await UserInfo.findById(interaction.user.id).exec();
		if (!userInfo) {
			userInfo = new UserInfo({
				_id: interaction.user.id,
			});
		}
		userInfo.lastAssigned = new Date();
		userInfo.isAssigned = true;
		// @ts-expect-error TS thinks that isAssigned is possibly false
		userInfo.assignedTo = issueId;

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

		const languages = interaction.message.embeds[0].fields![3].value.split(', ');
		const status = interaction.message.embeds[0].fields![0].value;

		const valid = await checkValid(member, status, languages)
			.catch((err) => {
				logger.error(err);
				interaction.editReply(strings.assignmentFail);
			});

		if (!valid) {
			await interaction.editReply(strings.assignmentNotPossible);
		} else {
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
		await interaction.deferReply({ ephemeral: true });
		const issueKey = interaction.customId.split(':')[1];

		const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
			params: { id: interaction.user.id },
			auth: {
				username: config.oauthServer.clientId,
				password: config.oauthServer.clientSecret,
			},
		}).catch((err) => {
			logger.log(err.response.data);
			throw new Error(err);
		}) as AxiosResponse<any>;

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

		const languages = interaction.message.embeds[0].fields![3].value.split(', ');

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
		await interaction.deferReply({ ephemeral: true });
		const issueKey = interaction.customId.split(':')[1];

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
	}
}
