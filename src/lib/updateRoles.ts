import { GuildMember } from 'discord.js';
import { logger } from '../index';
import UserInfo from '../models/UserInfo';

const config = require('../../config.json');

export default async function updateRoles(member: GuildMember) {
	if (member.guild.id !== config.discord.guild) return;
	let user = await UserInfo.findById(member.id).exec();
	if (!user) {
		user = new UserInfo({
			_id: member.id,
		});
	}
	user.roles = member.roles.cache.map((role) => role.id);
	user.save((err) => {
		logger.error(err);
	});
}
