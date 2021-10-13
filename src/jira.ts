/* eslint-disable no-console */
// Imports
import { Router, Request } from 'express';
import { BaseGuildTextChannel, MessageEmbed } from 'discord.js';
import axios from 'axios';

// Models
import IdLink from './models/IdLink';
import Setting from './models/Setting';
import GroupLink from './models/GroupLink';
import { client, clipQueue } from './index';
import clipRequest from './tools/clipper';
import { components } from './types/jira';

// Local files
const config = require('../config.json');
const strings = require('../strings.json');

// Variables
const url = `${config.jira.url}/rest/api/latest`;

// Init
// eslint-disable-next-line import/prefer-default-export
export const router = Router();

type JiraField = {
	value: string;
};

interface WebhookBody {
	timestamp: string;
	webhookEvent: string;
	user: components['schemas']['UserBean'];
	issue: components['schemas']['IssueBean'];
	changelog: components['schemas']['Changelog'];
	comment: components['schemas']['Comment'];
	transition: components['schemas']['Transition'] & { transitionName: string };
}

// Routes
router.post('/webhook', async (req: Request<{}, {}, WebhookBody>, res) => {
	if (req.query.token !== config.webhookSecret) {
		res.status(403).end();
		return;
	}
	res.status(200).end();

	const projectsChannelSetting = await Setting.findById('projectsChannel').lean().exec()
		.catch((err) => {
			throw new Error(err);
		});

	if (!projectsChannelSetting) return;

	const projectsChannel = await client.channels.fetch(projectsChannelSetting.value)
		.catch((err) => {
			throw new Error(err);
		}) as unknown as BaseGuildTextChannel | null;

	if (projectsChannel?.type !== 'GUILD_TEXT') throw new Error('Channel is not a guild text channel');

	if (req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') {
		const link = new IdLink({
			jiraId: req.body.issue.id,
			type: 'translation',
		});

		let languages = '';

		// eslint-disable-next-line no-return-assign
		req.body.issue.fields![config.jira.fields.langs].map((language: JiraField) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

		const embed = new MessageEmbed()
			.setTitle(`${req.body.issue.key}`)
			.setColor('#0052cc')
			.setDescription(req.body.issue.fields!.summary || 'None')
			.addField('Status', req.body.issue.fields!.status.name, true)
			.addField('Assignee', 'Unassigned', true)
			.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
			.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
			.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

		const msg = await projectsChannel.send({ embeds: [embed] })
			.catch((err) => {
				throw new Error(err);
			});
		link.discordMessageId = msg.id;
		link.save((err) => {
			if (err) throw err;
		});
	} else {
		const link = await IdLink.findOne({ jiraId: req.body.issue.id })
			.exec()
			.catch((err) => {
				throw err;
			});
		if (!link || link.finished) return;

		const msg = await projectsChannel.messages.fetch(link.discordMessageId!)
			.catch((err) => {
				throw new Error(err);
			});

		if (req.body.transition && req.body.transition.transitionName === 'Assign') {
			if (req.body.issue.fields!.assignee === null) {
				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: 'Unassigned',
				});
				msg.edit({ embeds: [embed] });

				const status = req.body.issue.fields!.status.name;
				if (status === 'Open' || status === 'Rejected' || status === 'Being clipped' || status === 'Uploaded') return;

				msg.react('819518919739965490');
			} else {
				const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields!.assignee.key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch((err) => {
					console.log(err.response.data);
					throw new Error(err);
				});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: `<@${user._id}>`,
				});
				msg.edit({ embeds: [embed] });
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						fetchedUser.send({ content: 'New assignment', embeds: [embed] });
					}).catch(console.error);
			}
		} else if (req.body.transition && req.body.transition.transitionName === 'Finish') {
			msg.delete();
			link.finished = true;
			link.save((err) => {
				if (err) throw err;
			});
		} else if (req.body.transition && req.body.transition.transitionName === 'Send to Ikari') {
			const videoRegex = /^(http(s)?:\/\/)?(www\.)?youtu((\.be\/)|(be\.com\/watch\?v=))[0-z_-]{11}$/g;
			const videoType = videoRegex.test(req.body.issue.fields![config.jira.fields.videoLink]) ? 'youtube' : 'other';
			console.log('REQ RECEIVED');
			clipQueue.push((cb) => {
				clipRequest([
					videoType,
					req.body.issue.fields![config.jira.fields.videoLink],
					req.body.issue.fields![config.jira.fields.timestamps],
					req.body.issue.fields!.summary,
					req.body.issue.fields![config.jira.fields.fileExt].value.toLowerCase(),
					req.body.issue.fields![config.jira.fields.extraArgs],
				])
					.then(() => {
						axios.post(`${url}/issue/${link.jiraId}/transitions`, {
							transition: {
								id: '41',
							},
						}, {
							auth: {
								username: config.jira.username,
								password: config.jira.password,
							},
						})
							.catch((err) => {
								console.log(err);
								throw new Error(err);
							});
						cb!();
					}, () => {
						axios.post(`${url}/issue/${link.jiraId}/transitions`, {
							transition: {
								id: '121',
							},
						}, {
							auth: {
								username: config.jira.username,
								password: config.jira.password,
							},
						})
							.catch((err) => {
								console.log(err);
								clipQueue.shift();
								clipQueue.start();
								throw new Error(err);
							});
						cb!();
					})
					.catch((err) => {
						console.log(err.response.data);
						throw new Error(err);
					});
			});
		} else {
			let languages = '';

			// eslint-disable-next-line no-return-assign
			req.body.issue.fields![config.jira.fields.langs].map((language: JiraField) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

			const embed = new MessageEmbed()
				.setTitle(`${req.body.issue.key}`)
				.setColor('#0052cc')
				.setDescription(req.body.issue.fields!.summary || 'None')
				.addField('Status', req.body.issue.fields!.status.name, true)
				.addField('Assignee', msg.embeds[0].fields[1].value, true)
				.addField('Source', `[link](${req.body.issue.fields![config.jira.fields.videoLink]})`)
				.setFooter(`Due date: ${req.body.issue.fields!.duedate || 'unknown'}`)
				.setURL(`${config.jira.url}/projects/${req.body.issue.fields!.project.key}/issues/${req.body.issue.key}`);

			msg.edit({ embeds: [embed] });
		}
	}
});

/* eslint-disable */
/*
router.post('/webhook/artist', async (req, res) => {
	if (req.query.token !== config.webhookSecret) {
		res.status(403).end();
		return;
	}
	res.status(200).end();

	const artistsProjectsChannelSetting = await Setting.findById('artistsProjectsChannel').lean().exec()
		.catch((err) => {
			throw new Error(err);
		});

	if (!artistsProjectsChannelSetting) return;

	const artistsProjectsChannel = await client.channels.fetch(artistsProjectsChannelSetting.value)
		.catch((err) => {
			throw new Error(err);
		}) as unknown as BaseGuildTextChannel | null;

	if (artistsProjectsChannel?.type !== 'GUILD_TEXT') throw new Error('Channel is not a guild text channel');

	if (req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') {
		const link = new IdLink({
			jiraId: req.body.issue.id,
			type: 'artist',
		});

		const embed = new MessageEmbed()
			.setTitle(`${req.body.issue.key}`)
			.setColor('#0052cc')
			.setDescription(req.body.issue.fields.summary || 'None')
			.addField('Status', req.body.issue.fields.status.name, true)
			.addField('Assignee', 'Unassigned', true)
			.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

		const msg = await artistsProjectsChannel.send({ embeds: [embed] })
			.catch((err) => {
				throw new Error(err);
			});

		link.discordMessageId = msg.id;
		link.save((err) => {
			if (err) throw err;
		});

		msg.react('819518919739965490');
	} else {
		const link = await IdLink.findOne({ jiraId: req.body.issue.id })
			.exec()
			.catch((err) => {
				throw new Error(err);
			});
		if (!link) return;

		const msg = await artistsProjectsChannel.messages.fetch(link.discordMessageId!)
			.catch((err) => {
				throw new Error(err);
			});

		if (req.body.transition && req.body.transition.transitionName === 'Assign') {
			if (req.body.issue.fields.assignee === null) {
				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: 'Unassigned',
				});
				msg.edit({ embeds: [embed] });

				msg.react('819518919739965490');
			} else {
				const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields.assignee.key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				}).catch((err) => {
					console.log(err.response.data);
					throw new Error(err);
				});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: `<@${user._id}>`,
				});
				msg.edit({ embeds: [embed] });
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						fetchedUser.send({ content: 'New assignment', embeds: [embed] });
					}).catch(console.error);
			}
		} else if (req.body.transition && req.body.transition.transitionName === 'Finish') {
			msg.delete();
			link.finished = true;
			link.save((err) => {
				if (err) throw err;
			});
		} else {
			const embed = new MessageEmbed()
				.setTitle(`Project - ${req.body.issue.key}`)
				.setColor('#0052cc')
				.setDescription(req.body.issue.fields.summary || 'None')
				.addField('Status', req.body.issue.fields.status.name)
				.addField('Assignee', msg.embeds[0].fields[1].value)
				.addField('Priority', req.body.issue.fields.priority.name)
				.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

			msg.edit({ embeds: [embed] });
		}
	}
});

// Event handlers
// eslint-disable-next-line max-len
export const messageReactionAddHandler = async (
	messageReaction: Discord.MessageReaction | Discord.PartialMessageReaction,
	receivedReactionUser: Discord.User | Discord.PartialUser,
) => {
	const reactionUser = await receivedReactionUser.fetch();
	if (reactionUser.bot || messageReaction.emoji.id !== '819518919739965490') return;
	const link = await IdLink.findOne({ discordMessageId: messageReaction.message.id }).lean().exec()
		.catch((err) => {
			messageReaction.users.remove(reactionUser);
			reactionUser.send(strings.assignmentFail);
			throw new Error(err);
		});
	if (!link) return;

	const projectsChannelSetting = await Setting.findById('projectsChannel').lean().exec()
		.catch((err) => {
			messageReaction.users.remove(reactionUser);
			reactionUser.send(strings.assignmentFail);
			throw new Error(err);
		});

	const artistsProjectsChannelSetting = await Setting.findById('artistsProjectsChannel').lean().exec()
		.catch((err) => {
			messageReaction.users.remove(reactionUser);
			reactionUser.send(strings.assignmentFail);
			throw new Error(err);
		});

	if (!projectsChannelSetting || !artistsProjectsChannelSetting) return;

	const projectsChannel = await client.channels.fetch(projectsChannelSetting.value)
		.catch((err) => {
			messageReaction.users.remove(reactionUser);
			reactionUser.send(strings.assignmentFail);
			throw new Error(err);
		}) as unknown as BaseGuildTextChannel | null;

	if (projectsChannel?.type !== 'GUILD_TEXT') throw new Error('Channel is not a guild text channel');

	const artistsProjectsChannel = await client.channels.fetch(artistsProjectsChannelSetting.value)
		.catch((err) => {
			messageReaction.users.remove(reactionUser);
			reactionUser.send(strings.assignmentFail);
			throw new Error(err);
		}) as unknown as BaseGuildTextChannel | null;

	if (artistsProjectsChannel?.type !== 'GUILD_TEXT') throw new Error('Channel is not a guild text channel');

	const guild = await messageReaction.message.guild!.fetch();
	const member = await guild.members.fetch(reactionUser);

	if (link.type === 'translation') {
		const msg = await projectsChannel.messages.fetch(link.discordMessageId!)
			.catch((err) => {
				messageReaction.users.remove(reactionUser);
				reactionUser.send(strings.assignmentFail);
				throw new Error(err);
			});

		const languages = msg.embeds[0].fields[3].value.split(', ');
		let valid = false;

		const status = msg.embeds[0].fields[0].value;

		if (status === 'Translating') {
			const roles = await Promise.all(languages.map(async (language) => {
				// @ts-expect-error
				const { _id: discordId } = await GroupLink.findOne({ jiraName: `Translator - ${language}` })
					.exec()
					.catch((err) => {
						messageReaction.users.remove(reactionUser);
						reactionUser.send(strings.assignmentFail);
						throw new Error(err);
					});
				return member.roles.cache.has(discordId);
			}));
			valid = roles.includes(true);
		} else if (status === 'Translation Check') {
			const roles = await Promise.all(languages.map(async (language) => {
				// @ts-expect-error
				const { _id: discordId } = await GroupLink.findOne({ jiraName: `Translation Checker - ${language}` })
					.exec()
					.catch((err) => {
						messageReaction.users.remove(reactionUser);
						reactionUser.send(strings.assignmentFail);
						throw new Error(err);
					});
				return member.roles.cache.has(discordId);
			}));
			valid = roles.includes(true);
		} else if (status === 'Proofreading') {
			// @ts-expect-error
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Proofreader' })
				.exec()
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send(strings.assignmentFail);
					throw new Error(err);
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'Subbing') {
			// @ts-expect-error
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Subtitler' })
				.exec()
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send(strings.assignmentFail);
					throw new Error(err);
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'PreQC') {
			// @ts-expect-error
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Pre-Quality Control' })
				.exec()
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send(strings.assignmentFail);
					throw new Error(err);
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'Video Editing') {
			// @ts-expect-error
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Video Editor' })
				.exec()
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send(strings.assignmentFail);
					throw new Error(err);
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'Quality Control') {
			// @ts-expect-error
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Quality Control' })
				.exec()
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send(strings.assignmentFail);
					throw new Error(err);
				});
			valid = member.roles.cache.has(discordId);
		}

		if (!valid) {
			await messageReaction.users.remove(reactionUser);
			await reactionUser.send(strings.assignmentNotPossible);
		} else {
			const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
				params: { id: reactionUser.id },
				auth: {
					username: config.oauthServer.clientId,
					password: config.oauthServer.clientSecret,
				},
			})
				.catch((err) => {
					reactionUser.send(strings.assignmentFail);
					console.log(err.response.data);
					throw new Error(err);
				});

			const embed = msg.embeds[0].spliceFields(1, 1, {
				name: 'Assignee',
				value: `<@${reactionUser.id}>`,
			});

			if (!user) {
				await messageReaction.users.remove(reactionUser);
				await reactionUser.send(strings.noJiraAccount);
			} else {
				axios.put(`${url}/issue/${link.jiraId}/assignee`, {
					name: user.username,
				}, {
					auth: {
						username: config.jira.username,
						password: config.jira.password,
					},
				})
					.then(() => {
						msg.edit({ embeds: [embed] });
						msg.reactions.removeAll();
						reactionUser.send({ content: 'New assignment', embeds: [embed] });
					})
					.catch((err) => {
						messageReaction.users.remove(reactionUser);
						reactionUser.send(strings.assignmentFail);
						console.log(err.response.data);
						throw new Error(err);
					});
			}
		}
	} else if (link.type === 'artist') {
		const msg = await artistsProjectsChannel.messages.fetch(link.discordMessageId!)
			.catch((err) => {
				messageReaction.users.remove(reactionUser);
				reactionUser.send(strings.assignmentFail);
				throw new Error(err);
			});

		// @ts-expect-error
		const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Artist' })
			.exec()
			.catch((err) => {
				messageReaction.users.remove(reactionUser);
				reactionUser.send(strings.assignmentFail);
				throw new Error(err);
			});
		if (member.roles.cache.has(discordId)) {
			const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
				params: { id: reactionUser.id },
				auth: {
					username: config.oauthServer.clientId,
					password: config.oauthServer.clientSecret,
				},
			})
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send(strings.assignmentFail);
					console.log(err.response.data);
					throw new Error(err);
				});

			const embed = msg.embeds[0].spliceFields(1, 1, {
				name: 'Assignee',
				value: `<@${reactionUser.id}>`,
			});

			if (!user) {
				await messageReaction.users.remove(reactionUser);
				await reactionUser.send(strings.noJiraAccount);
			} else {
				await axios.put(`${url}/issue/${link.jiraId}/assignee`, {
					name: user.username,
				}, {
					auth: {
						username: config.jira.username,
						password: config.jira.password,
					},
				})
					.then(() => {
						msg.edit({ embeds: [embed] });
						msg.reactions.removeAll();
						reactionUser.send({ content: 'New assignment', embeds: [embed] });
					})
					.catch((err) => {
						messageReaction.users.remove(reactionUser);
						reactionUser.send(strings.assignmentFail);
						console.log(err.response.data);
						throw new Error(err);
					});
			}
		} else {
			await messageReaction.users.remove(reactionUser);
			await reactionUser.send(strings.assignmentNotPossibleArtist);
		}
	}
};
 */
