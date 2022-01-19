import axios, { AxiosResponse } from 'axios';
import Discord, { MessageEmbed } from 'discord.js';
import { Version2Models } from 'jira.js';
import * as Sentry from '@sentry/node';
import format from 'string-template';
import { jiraClient, logger } from '../index';
import Setting from '../models/Setting';
import { allServicesOnline } from '../lib/middleware';
import UserInfo from '../models/UserInfo';

// Config
const config = require('../../config.json');
const strings = require('../../strings.json');

// eslint-disable-next-line consistent-return
export default async function commandInteractionHandler(interaction: Discord.CommandInteraction) {
	const isEverythingOnline = await allServicesOnline();
	if (!isEverythingOnline) {
		await interaction.reply({ content: strings.serviceOffline, ephemeral: true });
		return;
	}

	if (interaction.commandName === 'userinfo') {
		await interaction.deferReply();
		const user = interaction.options.getUser('user', true);
		const userDoc = await UserInfo.findById(user.id).exec();
		if (!userDoc) {
			await interaction.editReply(strings.userNotFound);
			return;
		}

		const embed = new Discord.MessageEmbed()
			.setTitle(user.tag)
			.addField(
				'Currently assigned to',
				userDoc.assignedTo
					? `[${userDoc.assignedTo}](${config.jira.url}/browse/${userDoc.assignedTo})${userDoc.assignedAs ? ` as ${userDoc.assignedAs === 'lqc' ? 'Language QC' : 'Sub QC'}` : ''}`
					: 'Nothing',
			)
			.addField('Last assigned', userDoc.lastAssigned ? `<t:${Math.floor(new Date(userDoc.lastAssigned).getTime() / 1000)}:D>` : 'never');
		const avatar = user.avatarURL();
		if (avatar) embed.setThumbnail(avatar);
		await interaction.editReply({ embeds: [embed] });
	} else if (interaction.commandName === 'project') {
		await interaction.deferReply();

		const key = interaction.options.getString('key', true);
		let issue;

		try {
			issue = await jiraClient.issues.getIssue({ issueIdOrKey: key });
		} catch (err: any) {
			if (err.response && err.response.status !== 404) {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching Jira issue (${eventId})`);
				await interaction.editReply(format(strings.unknownError, { eventId }));
				return;
			}
		}

		if (!issue) {
			await interaction.editReply('Issue not found.');
			return;
		}

		let languages = '';

		const folderUrl = encodeURI(`${config.webdav.baseUrl}/TL/Projects/${issue.key} - ${issue.fields.summary}`);

		let user = 'Unassigned';
		if (issue.fields.assignee) {
			type UserLink = {
				_id: string;
			};

			const res = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
				params: { key: issue.fields.assignee.key },
				auth: {
					username: config.oauthServer.clientId,
					password: config.oauthServer.clientSecret,
				},
			}).catch(async (err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
				await interaction.editReply(format(strings.unknownError, { eventId }));
			}) as AxiosResponse<UserLink>;
			if (!res) return;

			user = `<@${res.data._id}>`;
		}

		// eslint-disable-next-line no-return-assign
		issue.fields[config.jira.fields.langs]?.forEach((language: Version2Models.CustomFieldOption) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

		let timestamps = issue.fields[config.jira.fields.timestamps] ?? '';
		if (issue.fields[config.jira.fields.timestamps]?.split(',').length > 3) {
			timestamps = '';
			const split = issue.fields[config.jira.fields.timestamps].split(',');
			// eslint-disable-next-line no-plusplus
			for (let i = 0; i < 3; i++) {
				if (i !== 0)timestamps += ',';
				timestamps += split[i];
			}
			timestamps += '...';
		}

		let embed: MessageEmbed;
		if (issue.fields.status.name! === 'Sub QC/Language QC') {
			let LQCAssignee = 'Unassigned';
			let SQCAssignee = 'Unassigned';

			if (issue.fields[config.jira.fields.LQCAssignee]) {
				type UserLink = {
					_id: string;
				};

				const res = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: issue.fields[config.jira.fields.LQCAssignee].key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch(async (err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching Jira issue (${eventId})`);
					await interaction.editReply(format(strings.unknownError, { eventId }));
				}) as AxiosResponse<UserLink>;
				if (!res) return;
				LQCAssignee = `<@${res.data._id}>`;
			}

			if (issue.fields[config.jira.fields.SQCAssignee]) {
				type UserLink = {
					_id: string;
				};

				const res = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: issue.fields[config.jira.fields.SQCAssignee].key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch(async (err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching user from OAuth (${eventId})`);
					await interaction.editReply(format(strings.unknownError, { eventId }));
				}) as AxiosResponse<UserLink>;
				if (!res) return;
				SQCAssignee = `<@${res.data._id}>`;
			}

			embed = new MessageEmbed()
				.setTitle(issue.key!)
				.setColor('#0052cc')
				.setDescription(issue.fields.summary || 'No description available')
				.addField('Status', issue.fields.status.name)
				.addField('LQC Assignee', LQCAssignee, true)
				.addField('SQC Assignee', SQCAssignee, true)
				.addField(
					'LQC Status',
					(
						// eslint-disable-next-line no-nested-ternary
						(issue.fields[config.jira.fields.LQCSQCFinished] as any[] | null)?.find((item) => item.value === 'LQC_done') ? 'Done' : (
							issue.fields[config.jira.fields.LQCAssignee] === null ? 'To do' : 'In progress'
						) ?? 'To do'
					),
				)
				.addField(
					'SQC Status',
					(
						// eslint-disable-next-line no-nested-ternary
						(issue.fields[config.jira.fields.LQCSQCFinished] as any[] | null)?.find((item) => item.value === 'Sub_QC_done') ? 'Done' : (
							issue.fields[config.jira.fields.SQCAssignee] === null ? 'To do' : 'In progress'
						) ?? 'To do'
					),
				)
				.addField('Source', `[link](${issue.fields[config.jira.fields.videoLink]})`)
				.addField('Nextcloud folder', `[link](${folderUrl})`)
				.setFooter({ text: `Due date: ${issue.fields.duedate || 'unknown'}` })
				.setURL(`${config.jira.url}/projects/${issue.fields.project.key}/issues/${issue.key}`);
		} else {
			embed = new Discord.MessageEmbed()
				.setTitle(issue.key)
				.setColor('#0052cc')
				.setDescription(issue.fields.summary || 'No description available')
				.addField('Status', issue.fields.status.name!)
				.addField('Assignee', user)
				.addField('Source', `[link](${issue.fields[config.jira.fields.videoLink]})`)
				.addField('Nextcloud folder', `[link](${folderUrl})`)
				.setFooter({ text: `Due date: ${issue.fields.duedate || 'unknown'}` })
				.setURL(`${config.jira.url}/projects/${issue.fields.project.key}/issues/${issue.key}`);
		}

		if (timestamps) embed.addField('Timestamp(s)', timestamps);

		await interaction.editReply({ embeds: [embed] });
	} else if (interaction.commandName === 'setting') {
		await interaction.deferReply({ ephemeral: true });

		const settingName = interaction.options.getString('name', true);
		const newValue = interaction.options.getString('value', false);

		const setting = await Setting.findById(settingName).exec();
		if (newValue) {
			if (setting) {
				const prevValue = setting.value;
				setting.value = newValue;

				const embed = new Discord.MessageEmbed()
					.setTitle(`Setting: ${setting._id}`)
					.setDescription('Updated setting')
					.addField('Old value', prevValue)
					.addField('New value', setting.value);

				await setting.save(async (err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving setting (${eventId})`);
						await interaction.editReply(format(strings.unknownError, { eventId }));
					} else {
						await interaction.editReply({ embeds: [embed] });
					}
				});
			} else {
				const newSetting = new Setting({
					_id: settingName,
					value: newValue,
				});

				const embed = new Discord.MessageEmbed()
					.setTitle(`Setting: ${newSetting._id}`)
					.setDescription('Created setting')
					.addField('New value', newSetting.value);

				await newSetting.save(async (err) => {
					if (err) {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while saving setting (${eventId})`);
						await interaction.editReply(format(strings.unknownError, { eventId }));
					} else {
						await interaction.editReply({ embeds: [embed] });
					}
				});
			}
		} else if (setting) {
			const embed = new Discord.MessageEmbed()
				.setTitle(`Setting: ${setting._id}`)
				.addField('Value', setting.value);
			await interaction.editReply({ embeds: [embed] });
		} else {
			await interaction.editReply('Setting not found');
		}
	}
}
