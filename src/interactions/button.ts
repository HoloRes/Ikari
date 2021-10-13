/* eslint-disable */
/*
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
