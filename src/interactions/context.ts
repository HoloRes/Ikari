import Discord, { UserContextMenuInteraction } from 'discord.js';
import * as Sentry from '@sentry/node';
import format from 'string-template';
import { allServicesOnline } from '../lib/middleware';
import UserInfo from '../models/UserInfo';
import { logger } from '../index';

const strings = require('../../strings.json');
const config = require('../../config.json');

// eslint-disable-next-line max-len
export default async function userContextMenuInteractionHandler(interaction: UserContextMenuInteraction) {
	const isEverythingOnline = await allServicesOnline();
	if (!isEverythingOnline) {
		await interaction.reply({ content: strings.serviceOffline, ephemeral: true });
	}
	if (interaction.commandName === 'Show user info') {
		await interaction.deferReply({ ephemeral: true });

		let encounteredError = false;

		const user = interaction.options.getUser('user', true);
		const userDoc = await UserInfo.findById(user.id).exec()
			.catch((err: Error) => {
				const eventId = Sentry.captureException(err);
				logger.error(`Encountered error while fetching project link (${eventId})`);
				logger.error(err);
				interaction.editReply(format(strings.assignmentFail, { eventId }));
				encounteredError = true;
			});
		if (encounteredError) return;

		if (!userDoc) {
			await interaction.editReply(strings.userNotFound);
			return;
		}

		let assignedTo = '';
		if (userDoc.assignedTo.length === 0) {
			assignedTo = 'None';
		} else {
			for (let i = 0; i < userDoc.assignedTo.length; i++) {
				assignedTo += `${(i > 0 && i + 1 < userDoc.assignedTo.length) ? ', ' : ''}${(i > 0 && i + 1 === userDoc.assignedTo.length) ? ' and ' : ''}[${userDoc.assignedTo[i]}](${config.jira.url}/browse/${userDoc.assignedTo[i]})${userDoc.assignedAs.has(userDoc.assignedTo[i]) ? ` as ${userDoc.assignedAs.get(userDoc.assignedTo[i]) === 'lqc' ? 'Language QC' : 'Sub QC'}` : ''}`;
			}
		}

		const embed = new Discord.MessageEmbed()
			.setTitle(user.tag)
			.addField('Currently assigned to', assignedTo)
			.addField('Last assigned', userDoc.lastAssigned ? `<t:${Math.floor(new Date(userDoc.lastAssigned).getTime() / 1000)}:D>` : 'never');
		const avatar = user.avatarURL();
		if (avatar) embed.setThumbnail(avatar);
		await interaction.editReply({ embeds: [embed] });
	}
}
