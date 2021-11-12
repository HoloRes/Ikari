import Discord from 'discord.js';
import axios, { AxiosResponse } from 'axios';
import { jiraClient } from '../index';
import UserInfo from '../models/UserInfo';
import IdLink from '../models/IdLink';

const config = require('../../config.json');
const strings = require('../../strings.json');

export default async function buttonInteractionHandler(interaction: Discord.ButtonInteraction) {
	// TODO: Add interaction handlers for LQC, SQC and artist
	if (interaction.customId.startsWith('assignToMe:')) {
		await interaction.deferReply({ ephemeral: true });
		const issueId = interaction.customId.split(':')[1];

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
				interaction.user.send(strings.assignmentFail);
				throw err;
			});
		if (!link) return;

		const member = await interaction.guild!.members.fetch(interaction.user.id)
			.catch((err) => {
				throw err;
			});
		if (!member) return;

		const msg = interaction.message;

		const languages = msg.embeds[0].fields![3].value.split(', ');
		let valid = false;

		const status = msg.embeds[0].fields![0].value;

		if (status === 'Translating') {
			const roles = await Promise.all(languages.map(async (language: string) => {
				// @ts-expect-error
				const { _id: discordId } = await GroupLink.findOne({ jiraName: `Translator - ${language}` })
					.exec()
					.catch((err: Error) => {
						interaction.user.send(strings.assignmentFail);
						throw err;
					});
				return member.roles.cache.has(discordId);
			}));
			valid = roles.includes(true);
		} else if (status === 'Translation Check') {
			const roles = await Promise.all(languages.map(async (language: string) => {
				// @ts-expect-error
				const { _id: discordId } = await GroupLink.findOne({ jiraName: `Translation Checker - ${language}` })
					.exec()
					.catch((err: Error) => {
						interaction.user.send(strings.assignmentFail);
						throw err;
					});
				return member.roles.cache.has(discordId);
			}));
			valid = roles.includes(true);
		} else if (status === 'Proofreading') {
			// @ts-expect-error
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Proofreader' })
				.exec()
				.catch((err: Error) => {
					interaction.user.send(strings.assignmentFail);
					throw err;
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'Subbing') {
			// @ts-expect-error
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Subtitler' })
				.exec()
				.catch((err: Error) => {
					interaction.user.send(strings.assignmentFail);
					throw err;
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'PreQC') {
			// @ts-expect-error
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Pre-Quality Control' })
				.exec()
				.catch((err: Error) => {
					interaction.user.send(strings.assignmentFail);
					throw err;
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'Video Editing') {
			// @ts-expect-error
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Video Editor' })
				.exec()
				.catch((err: Error) => {
					interaction.user.send(strings.assignmentFail);
					throw err;
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'Quality Control') {
			// @ts-expect-error
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Quality Control' })
				.exec()
				.catch((err: Error) => {
					interaction.user.send(strings.assignmentFail);
					throw err;
				});
			valid = member.roles.cache.has(discordId);
		}

		if (!valid) {
			await interaction.user.send(strings.assignmentNotPossible);
		} else {
			// @ts-expect-error accountId missing
			await jiraClient.issues.assignIssue({
				issueIdOrKey: issueId,
				name: user.username,
			});
			await userInfo.save();
		}
	}
}
