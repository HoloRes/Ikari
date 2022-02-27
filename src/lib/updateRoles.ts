import { GuildMember } from 'discord.js';
import * as Sentry from '@sentry/node';
import { logger } from '../index';
import UserInfo from '../models/UserInfo';

const config = require('../../config.json');

export default async function updateRoles(member: GuildMember) {
	let encounteredError = false;

	if (member.guild.id !== config.discord.guild) return;

	let user = await UserInfo.findById(member.id).exec()
		.catch((err) => {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while fetching user doc (${eventId})`);
			logger.error(err);
			encounteredError = true;
		});
	if (encounteredError) return;

	if (!user) {
		user = new UserInfo({
			_id: member.id,
		});
	}
	user.roles = member.roles.cache.map((role) => role.id);
	user.save((err) => {
		if (err) {
			const eventId = Sentry.captureException(err);
			logger.error(`Encountered error while saving user doc (${eventId})`);
			logger.error(err);
		}
	});
}
