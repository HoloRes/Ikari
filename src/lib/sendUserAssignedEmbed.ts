import Discord, { MessageActionRow, MessageButton } from 'discord.js';
import { Project } from '../models/IdLink';
import { jiraClient } from '../index';

export default async function sendUserAssignedEmbed(project: Project, user: Discord.User) {
	const issue = await jiraClient.issues.getIssue({
		issueIdOrKey: project.jiraId!,
	});

	const componentRow = new MessageActionRow()
		.addComponents(
			new MessageButton()
				.setCustomId(`abandonProject:${project.jiraId}`)
				.setLabel('Abandon project'),
		);

	const embed = new Discord.MessageEmbed()
		.setTitle(`New assignment: ${issue.fields.summary}`)
		.setDescription('You have been assigned to a new project')
		.setColor('#0052cc')
		.addField('Description', issue.fields.description ?? 'No description available')
		.setFooter(issue.key)
		.setURL(`https://jira.hlresort.community/browse/${issue.key}`);

	await user.send({ embeds: [embed], components: [componentRow] });
}
