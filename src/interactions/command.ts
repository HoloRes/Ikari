import axios, { AxiosResponse } from 'axios';
import Discord from 'discord.js';
import { components as JiraComponents } from '../types/jira';
import { jiraClient } from '../index';

// Config
const config = require('../config.json');

// eslint-disable-next-line consistent-return
export default async function commandInteractionHandler(interaction: Discord.CommandInteraction) {
	if (interaction.commandName === 'project') {
		await interaction.deferReply();

		const key = interaction.options.getString('id', true);

		const issue = await jiraClient.issues.getIssue({ issueIdOrKey: key })
			.catch(async (err) => {
				console.error(err);
				await interaction.editReply('Something went wrong, please try again later.');
			});

		if (!issue) {
			return interaction.editReply('Issue not found.');
		}

		let languages = '';

		let user = 'None';
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
				console.log(err.response.data);
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

		const embed = new Discord.MessageEmbed()
			.setTitle(` ${issue.key}`)
			.setColor('#0052cc')
			.setDescription(issue.fields!.summary || 'None')
			.addField('Status', issue.fields!.status.name!, true)
			.addField('Assignee', user, true)
			.addField('Source', `[link](${issue.fields![config.jira.fields.videoLink]})`)
			.addField('Timestamp(s)', timestamps)
			.setURL(`${config.jira.url}/projects/${issue.fields!.project.key}/issues/${issue.key}`)
			.setFooter(`Due date: ${issue.fields!.duedate || 'unknown'}`);

		await interaction.editReply({ embeds: [embed] });
	}
}
