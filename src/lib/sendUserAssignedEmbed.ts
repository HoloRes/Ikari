import Discord, { MessageActionRow, MessageButton } from 'discord.js';
import { Project } from '../models/IdLink';
import { jiraClient } from '../index';

export default async function sendUserAssignedEmbed(project: Project, user: Discord.User) {
	const issue = await jiraClient.issues.getIssue({
		issueIdOrKey: project.jiraKey!,
	});

	const componentRow = new MessageActionRow()
		.addComponents(
			new MessageButton()
				.setStyle('DANGER')
				.setCustomId(`abandonProject:${project.jiraKey}`)
				.setLabel('Abandon project'),
		);

	const embed = new Discord.MessageEmbed()
		.setTitle(`New assignment: ${issue.fields.summary}`)
		.setDescription('You have been assigned to a new project')
		.setColor('#0052cc')
		.addField('Description', issue.fields.description ?? 'No description available')
		.setFooter(project.jiraKey!)
		.setURL(`https://jira.hlresort.community/browse/${project.jiraKey}`);

	await user.send({ embeds: [embed], components: [componentRow] });
}
