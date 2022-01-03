import Discord, { UserContextMenuInteraction } from 'discord.js';
import { allServicesOnline } from '../lib/middleware';
import UserInfo from '../models/UserInfo';

const strings = require('../../strings.json');

// eslint-disable-next-line max-len
export default async function userContextMenuInteractionHandler(interaction: UserContextMenuInteraction) {
	const isEverythingOnline = await allServicesOnline();
	if (!isEverythingOnline) {
		await interaction.reply({ content: strings.serviceOffline, ephemeral: true });
	}
	if (interaction.commandName === 'Show user info') {
		await interaction.deferReply({ ephemeral: true });
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
					? `[${userDoc.assignedTo}](https://jira.hlresort.community/browse/${userDoc.assignedTo})${userDoc.assignedAs ? ` as ${userDoc.assignedAs === 'lqc' ? 'Language QC' : 'Sub QC'}` : ''}`
					: 'Nothing',
			)
			.addField('Last assigned', userDoc.lastAssigned ? `<t:${Math.floor(new Date(userDoc.lastAssigned).getTime() / 1000)}:D>` : 'never');
		const avatar = user.avatarURL();
		if (avatar) embed.setThumbnail(avatar);
		await interaction.editReply({ embeds: [embed] });
	}
}
