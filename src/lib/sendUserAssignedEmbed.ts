import Discord, { MessageActionRow, MessageButton } from 'discord.js';
import * as Sentry from '@sentry/node';
import { Project } from '../models/IdLink';
import { jiraClient, logger } from '../index';

const config = require('../../config.json');

export default async function sendUserAssignedEmbed(project: Project, user: Discord.User, type: 'translation' | 'artist' = 'translation') {
	const issue = await jiraClient.issues.getIssue({
		issueIdOrKey: project.jiraKey!,
	});

	let componentRow: MessageActionRow;
	if (type === 'artist') {
		componentRow = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setStyle('DANGER')
					.setCustomId(`artist:abandonProject:${project.jiraKey}`)
					.setLabel('Abandon project'),
				new MessageButton()
					.setStyle('SUCCESS')
					.setCustomId(`artist:markInProgress:${project.jiraKey}`)
					.setLabel('Mark in progress'),
			);
	} else {
		componentRow = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setStyle('DANGER')
					.setCustomId(`abandonProject:${project.jiraKey}`)
					.setLabel('Abandon project'),
				new MessageButton()
					.setStyle('SUCCESS')
					.setCustomId(`markInProgress:${project.jiraKey}`)
					.setLabel('Mark in progress'),
			);
	}

	const embed = new Discord.MessageEmbed()
		.setTitle(`New assignment: ${issue.fields.summary}`)
		.setDescription('You have been assigned to a new project')
		.setColor('#0052cc')
		.addField('Description', issue.fields.description ?? 'No description available')
		.setFooter({ text: project.jiraKey! })
		.setURL(`${config.jira.url}/browse/${project.jiraKey}`);

	await user.send({ embeds: [embed], components: [componentRow] })
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error sending message (${eventId})`);
			logger.error(err);
		});
}
