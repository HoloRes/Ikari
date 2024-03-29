import Discord from 'discord.js';
import GroupLink from '../models/GroupLink';

export default async function checkValid(
	member: Discord.GuildMember,
	status: string,
	languages: string[],
	role?: string,
): Promise<boolean> {
	const hiatusRole = await GroupLink.findOne({ jiraName: 'Hiatus' })
		.exec()
		.catch((err: Error) => {
			throw err;
		});
	if (hiatusRole && member.roles.cache.has(hiatusRole._id)) return false;

	if (status === 'Translating') {
		const roles = await Promise.all(languages.map(async (language: string) => {
			const doc = await GroupLink.findOne({ jiraName: `Translator - ${language}` })
				.exec()
				.catch((err: Error) => {
					throw err;
				});
			if (doc) return member.roles.cache.has(doc._id);
			return false;
		}));
		return roles.includes(true);
	}
	if (status === 'Translation Check') {
		const roles = await Promise.all(languages.map(async (language: string) => {
			const doc = await GroupLink.findOne({ jiraName: `Translation Checker - ${language}` })
				.exec()
				.catch((err: Error) => {
					throw err;
				});
			if (doc) return member.roles.cache.has(doc._id);
			return false;
		}));
		return roles.includes(true);
	}
	if (status === 'Proofreading') {
		const doc = await GroupLink.findOne({ jiraName: 'Proofreader' })
			.exec()
			.catch((err: Error) => {
				throw err;
			});
		if (doc) return member.roles.cache.has(doc._id);
		return false;
	}
	if (status === 'Subbing') {
		const doc = await GroupLink.findOne({ jiraName: 'Subtitler' })
			.exec()
			.catch((err: Error) => {
				throw err;
			});
		if (doc) return member.roles.cache.has(doc._id);
		return false;
	}
	if (status === 'Sub QC/Language QC') {
		if (role === 'sqc') {
			const doc = await GroupLink.findOne({ jiraName: 'Sub QC' })
				.exec()
				.catch((err: Error) => {
					throw err;
				});
			if (doc) return member.roles.cache.has(doc._id);
			return false;
		}
		if (role === 'lqc') {
			const roles = await Promise.all(languages.map(async (language: string) => {
				const doc = await GroupLink.findOne({ jiraName: `Language QC - ${language}` })
					.exec()
					.catch((err: Error) => {
						throw err;
					});
				if (doc) return member.roles.cache.has(doc._id);
				return false;
			}));
			return roles.includes(true);
		}
	}
	if (status === 'Video editing') {
		const doc = await GroupLink.findOne({ jiraName: 'Video Editor' })
			.exec()
			.catch((err: Error) => {
				throw err;
			});
		if (doc) return member.roles.cache.has(doc._id);
		return false;
	}
	if (status === 'Release QC') {
		const doc = await GroupLink.findOne({ jiraName: 'Release QC' })
			.exec()
			.catch((err: Error) => {
				throw err;
			});
		if (doc) return member.roles.cache.has(doc._id);
		return false;
	}
	return false;
}
