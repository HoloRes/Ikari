import Discord from 'discord.js';
import axios, { AxiosResponse } from 'axios';
import { jiraClient } from '../index';
import IdLink from '../models/IdLink';
import GroupLink from '../models/GroupLink';
import UserInfo from '../models/UserInfo';

const config = require('../../config.json');
const strings = require('../../strings.json');

export default async function buttonInteractionHandler(interaction: Discord.ButtonInteraction) {
	if (!interaction.guild) return;

	// TODO: Add interaction handlers for LQC, SQC and artist
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
			console.log(err.response.data);
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

		let valid = false;

		if (status === 'Translating') {
			const roles = await Promise.all(languages.map(async (language: string) => {
				const doc = await GroupLink.findOne({ jiraName: `Translator - ${language}` })
					.exec()
					.catch((err: Error) => {
						interaction.editReply(strings.assignmentFail);
						throw err;
					});
				return member.roles.cache.has(doc?._id);
			}));
			valid = roles.includes(true);
		} else if (status === 'Translation Check') {
			const roles = await Promise.all(languages.map(async (language: string) => {
				const doc = await GroupLink.findOne({ jiraName: `Translation Checker - ${language}` })
					.exec()
					.catch((err: Error) => {
						interaction.editReply(strings.assignmentFail);
						throw err;
					});
				return member.roles.cache.has(doc?._id);
			}));
			valid = roles.includes(true);
		} else if (status === 'Proofreading') {
			const doc = await GroupLink.findOne({ jiraName: 'Proofreader' })
				.exec()
				.catch((err: Error) => {
					interaction.editReply(strings.assignmentFail);
					throw err;
				});
			valid = member.roles.cache.has(doc?._id);
		} else if (status === 'Subbing') {
			const doc = await GroupLink.findOne({ jiraName: 'Subtitler' })
				.exec()
				.catch((err: Error) => {
					interaction.editReply(strings.assignmentFail);
					throw err;
				});
			valid = member.roles.cache.has(doc?._id);
		} else if (status === 'PreQC') {
			const doc = await GroupLink.findOne({ jiraName: 'Pre-Quality Control' })
				.exec()
				.catch((err: Error) => {
					interaction.editReply(strings.assignmentFail);
					throw err;
				});
			valid = member.roles.cache.has(doc?._id);
		} else if (status === 'Video Editing') {
			const doc = await GroupLink.findOne({ jiraName: 'Video Editor' })
				.exec()
				.catch((err: Error) => {
					interaction.editReply(strings.assignmentFail);
					throw err;
				});
			valid = member.roles.cache.has(doc?._id);
		} else if (status === 'Quality Control') {
			const doc = await GroupLink.findOne({ jiraName: 'Quality Control' })
				.exec()
				.catch((err: Error) => {
					interaction.editReply(strings.assignmentFail);
					throw err;
				});
			valid = member.roles.cache.has(doc?._id);
		}

		if (!valid) {
			await interaction.editReply(strings.assignmentNotPossible);
		} else {
			// TODO: Error handling
			// @ts-expect-error accountId missing
			await jiraClient.issues.assignIssue({
				issueIdOrKey: issueKey,
				name: user.username,
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
			console.log(err.response.data);
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

		const roles = await Promise.all(languages.map(async (language: string) => {
			const doc = await GroupLink.findOne({ jiraName: `Language QC - ${language}` })
				.exec()
				.catch((err: Error) => {
					interaction.editReply(strings.assignmentFail);
					throw err;
				});
			return member.roles.cache.has(doc?._id);
		}));

		if (roles.includes(true)) {
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
			console.log(err.response.data);
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

		const doc = await GroupLink.findOne({ jiraName: 'Sub QC' })
			.exec()
			.catch((err: Error) => {
				interaction.editReply(strings.assignmentFail);
				throw err;
			});

		if (member.roles.cache.has(doc?._id)) {
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
