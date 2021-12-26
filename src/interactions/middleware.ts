import axios from 'axios';
import {
	logger, conn1, conn2, jiraClient,
} from '../index';

const config = require('../../config.json');

export async function updateUserGroups(discordId: string): Promise<void> {
	await axios.get(`${config.oauthServer.url}/api/updateUserGroups`, {
		params: { id: discordId },
		auth: {
			username: config.oauthServer.clientId,
			password: config.oauthServer.clientSecret,
		},
	}).catch((err) => {
		logger.error(err.response.data);
		throw new Error(err);
	});
}

export async function allServicesOnline(): Promise<boolean> {
	const online: boolean[] = [];
	// MongoDB
	await conn1.db.admin().ping()
		.then((res: any) => online.push(res?.ok === 1))
		.catch(() => online.push(false));
	await conn2.db.admin().ping()
		.then((res: any) => online.push(res?.ok === 1))
		.catch(() => online.push(false));

	// Jira
	await jiraClient.myself.getCurrentUser()
		.then(() => online.push(true))
		.catch(() => online.push(false));

	// OAuth
	await axios.get(`${config.oauthServer.url}/heartbeat`)
		.then((res) => online.push(res.status === 200))
		.catch(() => online.push(false));

	// When uploading is added back, add Nextcloud here too

	return !online.includes(false);
}
