import axios, { AxiosResponse } from 'axios';
import Discord, { MessageActionRow, MessageButton, MessageEmbed } from 'discord.js';
import { Version2Models } from 'jira.js';
import * as Sentry from '@sentry/node';
import format from 'string-template';
import parse from 'parse-duration';
import { client, jiraClient, logger } from '../index';
import Setting from '../models/Setting';
import { allServicesOnline } from '../lib/middleware';
import UserInfo from '../models/UserInfo';
import IdLink from '../models/IdLink';
import StatusLink from '../models/StatusLink';
import GroupLink from '../models/GroupLink';

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
		let assignedTo = '';
		for (let i = 0; i < userDoc.assignedTo.length; i++) {
			assignedTo += `${(i > 0 && i + 1 < userDoc.assignedTo.length) ? ', ' : ''}${(i > 0 && i + 1 === userDoc.assignedTo.length) ? ' and ' : ''}[${userDoc.assignedTo[i]}](${config.jira.url}/browse/${userDoc.assignedTo[i]})${userDoc.assignedAs.has(userDoc.assignedTo[i]) ? ` as ${userDoc.assignedAs.get(userDoc.assignedTo[i]) === 'lqc' ? 'Language QC' : 'Sub QC'}` : ''}`;
		}

		const embed = new Discord.MessageEmbed()
			.setTitle(user.tag)
			.addField('Currently assigned to', assignedTo)
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
	} else if (interaction.commandName === 'muteproject') {
		await interaction.deferReply();

		const key = interaction.options.getString('key', true);
		const durationStr = interaction.options.getString('duration', true);
		const duration = parse(durationStr);
		const mutedUntil = new Date(Date.now() + duration);

		const project = await IdLink.findOne({ jiraKey: key }).exec();
		if (!project) {
			await interaction.editReply('Project not found!');
			return;
		}

		if (project.discordMessageId) {
			const channelLink = await StatusLink.findById(project.status).lean().exec()
				.catch((err) => {
					const eventId = Sentry.captureException(err);
					logger.error(`Encountered error while fetching statuslink (${eventId})`);
				});
			if (channelLink) {
				const channel = await client.channels.fetch(channelLink.channel)
					.catch((err) => {
						const eventId = Sentry.captureException(err);
						logger.error(`Encountered error while fetching channel on Discord (${eventId})`);
					});
				if (channel && channel.type === 'GUILD_TEXT') {
					const msg = await channel.messages.fetch(project.discordMessageId);
					await msg.delete()
						.catch((err) => {
							const eventId = Sentry.captureException(err);
							logger.error(`Encountered error while deleting message on Discord (${eventId})`);
						});
				}
			}
		}

		project.mutedUntil = mutedUntil;
		project.discordMessageId = undefined;

		project.save(async (err) => {
			if (err) {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while saving setting (${eventId})`);
				await interaction.editReply(format(strings.unknownError, { eventId }));
			} else {
				await interaction.editReply(`Project ${project.jiraKey} has been muted until: <t:${Math.floor(mutedUntil.getTime() / 1000)}:D>`);
			}
		});
	} else if (interaction.commandName === 'unmuteproject') {
		let encounteredError = false;
		await interaction.deferReply();

		const key = interaction.options.getString('key', true);

		const project = await IdLink.findOne({ jiraKey: key }).exec();
		if (!project) {
			await interaction.editReply('Project not found!');
			return;
		}

		if (!project.mutedUntil) {
			await interaction.editReply('Project is not muted!');
			return;
		}

		const channelLink = await StatusLink.findById(project.status).lean().exec()
			.catch(async (err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching statuslink (${eventId})`);
				await interaction.editReply(format(strings.unknownError, { eventId }));
				encounteredError = true;
			});
		if (encounteredError || !channelLink) return;

		const channel = await client.channels.fetch(channelLink.channel)
			.catch(async (err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching channel on Discord (${eventId})`);
				await interaction.editReply(format(strings.unknownError, { eventId }));
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
		}).catch(async (err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching issue on jira (${eventId})`);
			await interaction.editReply(format(strings.unknownError, { eventId }));
			encounteredError = true;
		});
		if (encounteredError || !issue) return;

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
			.catch(async (err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while sending message (${eventId})`);
				logger.error('%o', err);
				await interaction.editReply(format(strings.unknownError, { eventId }));
				encounteredError = true;
			});
		if (encounteredError || !msg) return;

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

		await project.save(async (err) => {
			if (err) {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while saving issue link (${eventId})`);
				logger.error(err);
				await interaction.editReply(format(strings.unknownError, { eventId }));

				await msg?.delete()
					.catch((msgErr) => {
						const msgEventId = Sentry.captureException(msgErr);
						logger.error(`Encountered error while deleting message (${msgEventId})`);
						logger.error('%o', msgErr);
					});
			}
			await interaction.editReply(`Project ${project.jiraKey} has been unmuted.`);
		});
	} else if (interaction.commandName === 'inrole') {
		let encounteredError = false;
		if (!interaction.guild || interaction.guildId !== config.discord.guild) {
			await interaction.editReply('Wrong server, dummy.');
			return;
		}
		await interaction.deferReply();

		const role = interaction.options.getRole('role', true);
		const includeHiatus = interaction.options.getBoolean('includehiatus');
		const exclusive = interaction.options.getBoolean('onlyhiatus');

		const hiatusRoleLink = await GroupLink.findOne({ jiraName: 'Hiatus' }).exec()
			.catch(async (err) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching hiatus group link (${eventId})`);
				await interaction.editReply(format(strings.unknownError, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;
		if (!hiatusRoleLink) {
			await interaction.editReply(format(strings.unknownError, { eventId: 'NO_HIATUS_ROLE_LINK' }));
			return;
		}

		await interaction.guild.members.fetch();
		const members = interaction.guild.members.cache.filter((member) => {
			if (includeHiatus) {
				return (
					member.roles.cache.has(role.id)
					&& (exclusive ? member.roles.cache.has(hiatusRoleLink._id) : true)
				);
			}
			if (exclusive) {
				return member.roles.cache.has(role.id) && member.roles.cache.has(hiatusRoleLink._id);
			}
			return member.roles.cache.has(role.id) && !member.roles.cache.has(hiatusRoleLink._id);
		});

		const mentions = members.map((member) => `<@${member.id}>`);

		const embed = new Discord.MessageEmbed()
			.setTitle(`Members in role **@${role.name}**`)
			.setDescription(mentions.join('\n'))
			.setFooter({ text: `${(includeHiatus || exclusive) ? 'Includes' : 'Excludes'} hiatus ${exclusive ? '(exclusive)' : ''}` })
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	}
}
