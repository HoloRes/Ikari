// Imports
const { Router } = require('express');
const { MessageEmbed } = require('discord.js');
const axios = require('axios');

// Models
const IdLink = require('./models/IdLink');
const Setting = require('./models/Setting');
const GroupLink = require('./models/GroupLink');

// Local files
const config = require('./config.json');
const { client } = require('./index');
const { clipRequest } = require('./tools/clipper');

// Variables
const url = `${config.jira.url}/rest/api/latest`;

// Init
const router = Router();
exports.router = router;

// Routes
router.post('/webhook', async (req, res) => {
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
		});

	if (req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') {
		const link = new IdLink({
			jiraId: req.body.issue.id,
			type: 'translation',
		});

		let languages = '';

		//* Language field for dev: customfield_10202, prod: customfield_10015
		// eslint-disable-next-line no-return-assign
		req.body.issue.fields.customfield_10202.map((language) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

		const embed = new MessageEmbed()
			.setTitle(`Project - ${req.body.issue.key}`)
			.setColor('#0052cc')
			.setDescription(req.body.issue.fields.summary || 'None')
			.addField('Status', req.body.issue.fields.status.name)
			.addField('Assignee', 'Unassigned')
			.addField('Priority', req.body.issue.fields.priority.name)
			.addField('Languages', languages)
			.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

		const msg = await projectsChannel.send(embed)
			.catch((err) => {
				throw new Error(err);
			});
		link.discordMessageId = msg.id;
		link.save((err) => {
			if (err) throw new Error(err);
		});
	} else {
		const link = await IdLink.findOne({ jiraId: req.body.issue.id })
			.exec()
			.catch((err) => {
				throw new Error(err);
			});
		if (!link || link.finished) return;

		const msg = await projectsChannel.messages.fetch(link.discordMessageId)
			.catch((err) => {
				throw new Error(err);
			});

		if (req.body.transition && req.body.transition.transitionName === 'Assign') {
			if (req.body.issue.fields.assignee === null) {
				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: 'Unassigned',
				});
				msg.edit(embed);

				const status = req.body.issue.fields.status.name;
				if (status === 'Open' || status === 'Rejected' || status === 'Being clipped' || status === 'Uploaded') return;

				msg.react('819518919739965490');
			} else {
				const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields.assignee.key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				})
					.catch((err) => {
						console.log(err.response.data);
						throw new Error(err);
					});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: `<@${user._id}>`,
				});
				msg.edit(embed);
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						fetchedUser.send('New assignment', { embed });
					}).catch(console.error);
			}
		} else if (req.body.transition && req.body.transition.transitionName === 'Finish') {
			msg.delete();
			link.finished = true;
			link.save();
		} else if (req.body.transition && req.body.transition.transitionName === 'Send to Ikari') {
			console.log(req.body.issue.fields.customfield_10300.value.toLowerCase());
			const videoRegex = /^(http(s)?:\/\/)?(www\.)?youtu((\.be\/)|(be\.com\/watch\?v=))[0-z]{11}$/g;
			const videoType = videoRegex.test(req.body.issue.fields.customfield_10200) ? 'youtube' : 'other';
			clipRequest([
				videoType,
				req.body.issue.fields.customfield_10200,
				req.body.issue.fields.customfield_10201,
				req.body.issue.fields.summary,
				req.body.issue.fields.customfield_10300.value.toLowerCase(),
				req.body.issue.fields.customfield_10205,
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
							console.log(err.response.data);
							throw new Error(err);
						});
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
							console.log(err.response.data);
							throw new Error(err);
						});
				})
				.catch((err) => {
					console.log(err.response.data);
					throw new Error(err);
				});
		} else {
			let languages = '';

			//* Language field for dev: customfield_10202
			// eslint-disable-next-line no-return-assign
			req.body.issue.fields.customfield_10202.map((language) => (languages.length === 0 ? languages += language.value : languages += `, ${language.value}`));

			const embed = new MessageEmbed()
				.setTitle(`Project - ${req.body.issue.key}`)
				.setColor('#0052cc')
				.setDescription(req.body.issue.fields.summary || 'None')
				.addField('Status', req.body.issue.fields.status.name)
				.addField('Assignee', msg.embeds[0].fields[1].value)
				.addField('Priority', req.body.issue.fields.priority.name)
				.addField('Languages', languages)
				.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

			msg.edit(embed);
		}
	}
});

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
		});

	if (req.body.webhookEvent && req.body.webhookEvent === 'jira:issue_created') {
		const link = new IdLink({
			jiraId: req.body.issue.id,
			type: 'artist',
		});

		const embed = new MessageEmbed()
			.setTitle(`Project - ${req.body.issue.key}`)
			.setColor('#0052cc')
			.setDescription(req.body.issue.fields.summary || 'None')
			.addField('Status', req.body.issue.fields.status.name)
			.addField('Assignee', 'Unassigned')
			.addField('Priority', req.body.issue.fields.priority.name)
			.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

		const msg = await artistsProjectsChannel.send(embed)
			.catch((err) => {
				throw new Error(err);
			});
		link.discordMessageId = msg.id;
		link.save((err) => {
			if (err) throw new Error(err);
		});

		msg.react('819518919739965490');
	} else {
		const link = await IdLink.findOne({ jiraId: req.body.issue.id })
			.lean()
			.exec()
			.catch((err) => {
				throw new Error(err);
			});
		if (!link) return;

		const msg = await artistsProjectsChannel.messages.fetch(link.discordMessageId)
			.catch((err) => {
				throw new Error(err);
			});

		if (req.body.transition && req.body.transition.transitionName === 'Assign') {
			if (req.body.issue.fields.assignee === null) {
				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: 'Unassigned',
				});
				msg.edit(embed);

				msg.react('819518919739965490');
			} else {
				const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByJiraKey`, {
					params: { key: req.body.issue.fields.assignee.key },
					auth: {
						username: config.oauthServer.clientId,
						password: config.oauthServer.clientSecret,
					},
				})
					.catch((err) => {
						console.log(err.response.data);
						throw new Error(err);
					});

				const embed = msg.embeds[0].spliceFields(1, 1, {
					name: 'Assignee',
					value: `<@${user._id}>`,
				});
				msg.edit(embed);
				client.users.fetch(user._id)
					.then((fetchedUser) => {
						fetchedUser.send('New assignment', { embed });
					}).catch(console.error);
			}
		} else if (req.body.transition && req.body.transition.transitionName === 'Finish') {
			msg.delete();
			link.finished = true;
			link.save();
		} else {
			const embed = new MessageEmbed()
				.setTitle(`Project - ${req.body.issue.key}`)
				.setColor('#0052cc')
				.setDescription(req.body.issue.fields.summary || 'None')
				.addField('Status', req.body.issue.fields.status.name)
				.addField('Assignee', msg.embeds[0].fields[1].value)
				.addField('Priority', req.body.issue.fields.priority.name)
				.setURL(`${config.jira.url}/projects/${req.body.issue.fields.project.key}/issues/${req.body.issue.key}`);

			msg.edit(embed);
		}
	}
});

// Event handlers
exports.messageReactionAddHandler = async (messageReaction, reactionUser) => {
	if (reactionUser.bot || messageReaction.emoji.id !== '819518919739965490') return;
	const link = await IdLink.findOne({ discordMessageId: messageReaction.message.id }).lean().exec()
		.catch((err) => {
			messageReaction.users.remove(reactionUser);
			reactionUser.send('Assigning failed, please try again');
			throw new Error(err);
		});
	if (!link) return;

	const projectsChannelSetting = await Setting.findById('projectsChannel').lean().exec()
		.catch((err) => {
			messageReaction.users.remove(reactionUser);
			reactionUser.send('Assigning failed, please try again');
			throw new Error(err);
		});

	const artistsProjectsChannelSetting = await Setting.findById('artistsProjectsChannel').lean().exec()
		.catch((err) => {
			messageReaction.users.remove(reactionUser);
			reactionUser.send('Assigning failed, please try again');
			throw new Error(err);
		});

	if (!projectsChannelSetting || !artistsProjectsChannelSetting) return;

	const projectsChannel = await client.channels.fetch(projectsChannelSetting.value)
		.catch((err) => {
			messageReaction.users.remove(reactionUser);
			reactionUser.send('Assigning failed, please try again');
			throw new Error(err);
		});

	const artistsProjectsChannel = await client.channels.fetch(artistsProjectsChannelSetting.value)
		.catch((err) => {
			messageReaction.users.remove(reactionUser);
			reactionUser.send('Assigning failed, please try again');
			throw new Error(err);
		});

	const guild = await messageReaction.message.guild.fetch();
	const member = await guild.members.fetch(reactionUser);

	if (link.type === 'translation') {
		const msg = await projectsChannel.messages.fetch(link.discordMessageId)
			.catch((err) => {
				messageReaction.users.remove(reactionUser);
				reactionUser.send('Assigning failed, please try again');
				throw new Error(err);
			});

		const languages = msg.embeds[0].fields[3].value.split(', ');
		let valid = false;

		const status = msg.embeds[0].fields[0].value;

		if (status === 'Translating') {
			const roles = await Promise.all(languages.map(async (language) => {
				const { _id: discordId } = await GroupLink.findOne({ jiraName: `Translator - ${language}` })
					.exec()
					.catch((err) => {
						messageReaction.users.remove(reactionUser);
						reactionUser.send('Assigning failed, please try again');
						throw new Error(err);
					});
				return member.roles.cache.has(discordId);
			}));
			valid = roles.includes(true);
		} else if (status === 'Translation Check') {
			const roles = await Promise.all(languages.map(async (language) => {
				const { _id: discordId } = await GroupLink.findOne({ jiraName: `Translation Checker - ${language}` })
					.exec()
					.catch((err) => {
						messageReaction.users.remove(reactionUser);
						reactionUser.send('Assigning failed, please try again');
						throw new Error(err);
					});
				return member.roles.cache.has(discordId);
			}));
			valid = roles.includes(true);
		} else if (status === 'Proofreading') {
			// eslint-disable-next-line no-case-declarations
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Proofreader' })
				.exec()
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send('Assigning failed, please try again');
					throw new Error(err);
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'Subbing') {
			// eslint-disable-next-line no-case-declarations
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Subtitler' })
				.exec()
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send('Assigning failed, please try again');
					throw new Error(err);
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'PreQC') {
			// eslint-disable-next-line no-case-declarations
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Pre-Quality Control' })
				.exec()
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send('Assigning failed, please try again');
					throw new Error(err);
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'Video Editing') {
			// eslint-disable-next-line no-case-declarations
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Video Editor' })
				.exec()
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send('Assigning failed, please try again');
					throw new Error(err);
				});
			valid = member.roles.cache.has(discordId);
		} else if (status === 'Quality Control') {
			// eslint-disable-next-line no-case-declarations
			const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Quality Control' })
				.exec()
				.catch((err) => {
					messageReaction.users.remove(reactionUser);
					reactionUser.send('Assigning failed, please try again');
					throw new Error(err);
				});
			valid = member.roles.cache.has(discordId);
		}

		if (!valid) {
			messageReaction.users.remove(reactionUser);
			reactionUser.send('You can\'t be assigned in the current workflow status.');
		} else {
			const { data: user } = await axios.get(`${config.oauthServer.url}/api/userByDiscordId`, {
				params: { id: reactionUser.id },
				auth: {
					username: config.oauthServer.clientId,
					password: config.oauthServer.clientSecret,
				},
			})
				.catch((err) => {
					reactionUser.send('Assigning failed, please try again');
					console.log(err.response.data);
					throw new Error(err);
				});

			const embed = msg.embeds[0].spliceFields(1, 1, {
				name: 'Assignee',
				value: `<@${reactionUser.id}>`,
			});

			if (!user) {
				messageReaction.users.remove(reactionUser);
				reactionUser.send('Could not find your Jira account, please sign in once to link your account.');
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
						msg.edit(embed);
						msg.reactions.removeAll();
						reactionUser.send('New assignment', { embed });
					})
					.catch((err) => {
						messageReaction.users.remove(reactionUser);
						reactionUser.send('Assigning failed, please try again');
						console.log(err.response.data);
						throw new Error(err);
					});
			}
		}
	} else if (link.type === 'artist') {
		const msg = await artistsProjectsChannel.messages.fetch(link.discordMessageId)
			.catch((err) => {
				messageReaction.users.remove(reactionUser);
				reactionUser.send('Assigning failed, please try again');
				throw new Error(err);
			});

		const { _id: discordId } = await GroupLink.findOne({ jiraName: 'Artist' })
			.exec()
			.catch((err) => {
				messageReaction.users.remove(reactionUser);
				reactionUser.send('Assigning failed, please try again');
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
					reactionUser.send('Assigning failed, please try again');
					console.log(err.response.data);
					throw new Error(err);
				});

			const embed = msg.embeds[0].spliceFields(1, 1, {
				name: 'Assignee',
				value: `<@${reactionUser.id}>`,
			});

			if (!user) {
				messageReaction.users.remove(reactionUser);
				reactionUser.send('Could not find your Jira account, please sign in once to link your account.');
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
						msg.edit(embed);
						msg.reactions.removeAll();
						reactionUser.send('New assignment', { embed });
					})
					.catch((err) => {
						messageReaction.users.remove(reactionUser);
						reactionUser.send('Assigning failed, please try again');
						console.log(err.response.data);
						throw new Error(err);
					});
			}
		} else {
			messageReaction.users.remove(reactionUser);
			reactionUser.send('You can\'t be assigned to this issue (no artist role)');
		}
	}
};
