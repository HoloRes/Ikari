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
	if (member.roles.cache.has(hiatusRole?._id)) return false;

	if (status === 'Translating') {
		const roles = await Promise.all(languages.map(async (language: string) => {
			const doc = await GroupLink.findOne({ jiraName: `Translator - ${language}` })
				.exec()
				.catch((err: Error) => {
					throw err;
				});
			return member.roles.cache.has(doc?._id);
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
			return member.roles.cache.has(doc?._id);
		}));
		return roles.includes(true);
	}
	if (status === 'Proofreading') {
		const doc = await GroupLink.findOne({ jiraName: 'Proofreader' })
			.exec()
			.catch((err: Error) => {
				throw err;
			});
		return member.roles.cache.has(doc?._id);
	}
	if (status === 'Subbing') {
		const doc = await GroupLink.findOne({ jiraName: 'Subtitler' })
			.exec()
			.catch((err: Error) => {
				throw err;
			});
		return member.roles.cache.has(doc?._id);
	}
	if (status === 'PreQC') {
		const doc = await GroupLink.findOne({ jiraName: 'Pre-Quality Control' })
			.exec()
			.catch((err: Error) => {
				throw err;
			});
		return member.roles.cache.has(doc?._id);
	}
	if (status === 'Video Editing') {
		const doc = await GroupLink.findOne({ jiraName: 'Video Editor' })
			.exec()
			.catch((err: Error) => {
				throw err;
			});
		return member.roles.cache.has(doc?._id);
	}
	if (status === 'Quality Control') {
		const doc = await GroupLink.findOne({ jiraName: 'Quality Control' })
			.exec()
			.catch((err: Error) => {
				throw err;
			});
		return member.roles.cache.has(doc?._id);
	}
	if (status === 'Sub QC/Language QC') {
		if (role === 'sqc') {
			const doc = await GroupLink.findOne({ jiraName: 'Sub QC' })
				.exec()
				.catch((err: Error) => {
					throw err;
				});
			return member.roles.cache.has(doc?._id);
		}
		if (role === 'lqc') {
			const roles = await Promise.all(languages.map(async (language: string) => {
				const doc = await GroupLink.findOne({ jiraName: `Language QC - ${language}` })
					.exec()
					.catch((err: Error) => {
						throw err;
					});
				return member.roles.cache.has(doc?._id);
			}));
			return roles.includes(true);
		}
	}
	return false;
}
