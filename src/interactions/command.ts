import axios, { AxiosResponse } from 'axios';
import Discord, { MessageEmbed } from 'discord.js';
import { components as JiraComponents } from '../types/jira';
import { jiraClient, logger } from '../index';
import Setting from '../models/Setting';

// Config
const config = require('../../config.json');

// eslint-disable-next-line consistent-return
export default async function commandInteractionHandler(interaction: Discord.CommandInteraction) {
	// TODO: Add userinfo command
	if (interaction.commandName === 'project') {
		await interaction.deferReply();

		const key = interaction.options.getString('key', true);
		let issue;

		try {
			issue = await jiraClient.issues.getIssue({ issueIdOrKey: key });
		} catch (err: any) {
			if (err.response && err.response.status !== 404) {
				logger.error(err.response.body);
				await interaction.editReply('Something went wrong, please try again later.');
				return;
			}
		}

		if (!issue) {
			await interaction.editReply('Issue not found.');
			return;
		}

		let languages = '';

		let user = 'Unassigned';
		if (issue.fields!.assignee) {
			type UserLink = {
				_id: string;
			};

			const { data: userData } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
				params: { key: issue.fields!.assignee.key },
				auth: {
					username: config.oauthServer.clientId,
					password: config.oauthServer.clientSecret,
				},
			}).catch(async (err) => {
				logger.info(err.response.data);
				await interaction.editReply('Something went wrong, please try again later.');
				throw new Error(err);
			}) as AxiosResponse<UserLink>;
			user = `<@${userData._id}`;
		}

		// eslint-disable-next-line no-return-assign
		issue.fields![config.jira.fields.langs].map((language: JiraComponents['schemas']['CustomFieldOption']) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

		let timestamps = issue.fields![config.jira.fields.timestamps];
		if (issue.fields![config.jira.fields.timestamps].split(',').length > 3) {
			timestamps = '';
			const split = issue.fields![config.jira.fields.timestamps].split(',');
			// eslint-disable-next-line no-plusplus
			for (let i = 0; i < 3; i++) {
				if (i !== 0)timestamps += ',';
				timestamps += split[i];
			}
			timestamps += '...';
		}

		let embed: MessageEmbed;
		if (issue.fields!.status.name! === 'Sub QC/Language QC') {
			let LQCAssignee = 'Unassigned';
			let SubQCAssignee = 'Unassigned';

			if (issue.fields![config.jira.fields.LQCAssignee]) {
				type UserLink = {
					_id: string;
				};

				const { data: userData } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: issue.fields![config.jira.fields.LQCAssignee].key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch(async (err) => {
					logger.info(err.response.data);
					await interaction.editReply('Something went wrong, please try again later.');
					throw new Error(err);
				}) as AxiosResponse<UserLink>;
				LQCAssignee = `<@${userData._id}>`;
			}

			if (issue.fields![config.jira.fields.SubQCAssignee]) {
				type UserLink = {
					_id: string;
				};

				const { data: userData } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: issue.fields![config.jira.fields.SubQCAssignee].key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch(async (err) => {
					logger.info(err.response.data);
					await interaction.editReply('Something went wrong, please try again later.');
					throw new Error(err);
				}) as AxiosResponse<UserLink>;
				SubQCAssignee = `<@${userData._id}>`;
			}

			logger.info((issue.fields![config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'Sub_QC_done'));

			embed = new MessageEmbed()
				.setTitle(issue.key!)
				.setColor('#0052cc')
				.setDescription(issue.fields!.summary || 'No description available')
				.addField('Status', issue.fields!.status.name)
				.addField('LQC Assignee', LQCAssignee, true)
				.addField('SubQC Assignee', SubQCAssignee, true)
				.addField('LQC Status',
					(
						// eslint-disable-next-line no-nested-ternary
						(issue.fields![config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'LQC_done') ? 'Done' : (
							issue.fields![config.jira.fields.LQCAssignee] === null ? 'To do' : 'In progress'
						) ?? 'To do'
					))
				.addField('SubQC Status',
					(
						// eslint-disable-next-line no-nested-ternary
						(issue.fields![config.jira.fields.LQCSubQCFinished] as any[] | null)?.find((item) => item.value === 'Sub_QC_done') ? 'Done' : (
							issue.fields![config.jira.fields.SubQCAssignee] === null ? 'To do' : 'In progress'
						) ?? 'To do'
					))
				.addField('Source', `[link](${issue.fields![config.jira.fields.videoLink]})`)
				.addField('Timestamp(s)', timestamps)
				.setFooter(`Due date: ${issue.fields!.duedate || 'unknown'}`)
				.setURL(`${config.jira.url}/projects/${issue.fields!.project.key}/issues/${issue.key}`);
		} else {
			embed = new Discord.MessageEmbed()
				.setTitle(issue.key)
				.setColor('#0052cc')
				.setDescription(issue.fields!.summary || 'No description available')
				.addField('Status', issue.fields!.status.name!)
				.addField('Assignee', user)
				.addField('Source', `[link](${issue.fields![config.jira.fields.videoLink]})`)
				.addField('Timestamp(s)', timestamps)
				.setFooter(`Due date: ${issue.fields!.duedate || 'unknown'}`)
				.setURL(`${config.jira.url}/projects/${issue.fields!.project.key}/issues/${issue.key}`);
		}

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
						await interaction.editReply('Updating setting failed!');
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
						await interaction.editReply('Creating setting failed!');
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
