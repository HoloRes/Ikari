/* eslint-disable no-console */
const { nanoid } = require('nanoid');
const { exec } = require('child_process');
const os = require('os');
const { createClient } = require('webdav');
const fs = require('fs');

// Local files
const config = require('../config.json');

const idRegex = /(\?v=|be\/).{11}/g;

const webdavClient = createClient(
	config.webdavHost,
	{
		username: config.webdavUsername,
		password: config.webdavPassword,
		maxBodyLength: 100000000,
		maxContentLength: 100000000,
	},
);

if (!fs.existsSync('../download')) {
	fs.mkdirSync('../download');
}

async function clipRequest([videoType, videoLink, timestamps, projectName, fileExt]) {
	const internalId = `${videoLink.match(idRegex)[0].substring(3)}_${nanoid()}`;

	console.log(`Recieved Clipping Request ${internalId}`);
	if (await webdavClient.exists(`/TL Team/Projects/${projectName}/`) === false) {
		// TODO: set up project directory with necessary documents via WebDAV
		webdavClient.createDirectory(`/TL Team/Projects/${projectName}/`);
	}
	// This OS check is for development purposes only; will be removed in the future
	if (os.platform() === 'win32') {
		const cmd = `./clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn "${timestamps}" -dlDir "../download/" -fulltitle ${internalId} -fileOutExt ${fileExt}`;
		const res = exec(cmd, { shell: 'powershell.exe' }, async (error, stdout) => {
			console.log(stdout);
			console.log(error);
			if (error !== null) {
				console.log(error);
				return 1;
			}
			const stream = fs.createReadStream(`./download/${internalId}.${fileExt}`);
			const result = await webdavClient.putFileContents(`/TL Team/Projects/Test/${projectName.replace(/\s+/g, '')}.${fileExt}`, stream);
			if (result === false) {
				return 1;
			}
			fs.unlink(`./download/${internalId}.${fileExt}`, (err) => {
				if (err) console.log(err);
			});
			return 0;
		});
		if (res !== 0) return false;
	} else {
		const cmd = `pwsh ./clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn "${timestamps}" -dlDir "../download/" -fulltitle ${internalId} -fileOutExt ${fileExt}`;
		const res = exec(cmd, async (error, stdout) => {
			console.log(stdout);
			console.log(error);
			if (error !== null) {
				console.log(error);
				return 1;
			}
			const stream = fs.createReadStream(`./download/${internalId}.${fileExt}`);
			const result = await webdavClient.putFileContents(`/TL Team/Projects/Test/${projectName.replace(/\s+/g, '')}.${fileExt}`, stream);
			if (result === false) {
				return 1;
			}
			fs.unlink(`./download/${internalId}.${fileExt}`, (err) => {
				if (err) console.log(err);
			});
			return 0;
		});
		if (res !== 0) return false;
	}
	return true;
}
exports.clipRequest = clipRequest;
