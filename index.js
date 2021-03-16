/* eslint-disable max-len */
/* eslint-disable no-console */
// Packages
const { exec } = require('child_process');
const os = require('os');
const io = require('socket.io-client');
const fs = require('fs');
const { createClient } = require('webdav');

// Local files
const config = require('./config.json');

const webdavClient = createClient(
	config.webdavHost,
	{
		username: config.webdavUsername,
		password: config.webdavPassword,
		maxBodyLength: 100000000,
		maxContentLength: 100000000,
	},
);

const socket = io(config.clipperHost, {
	auth: {
		token: config.clipperAuthToken,
	},
});

socket.on('connect', () => {
	console.log('Connected!');
});

socket.on('request', async ({
	internalId,
	videoType,
	videoLink,
	timestamps,
	fileName,
	fileExt,
}) => {
	console.log(`Recieved Clipping Request ${internalId}`);
	if (await webdavClient.exists('/TL Team/Projects/Test/') === false) {
		// TODO: set up project directory with necessary documents via WebDAV
		webdavClient.createDirectory('/TL Team/Projects/Test/');
	}
	// This OS check is for development purposes only; will be removed in the future
	if (os.platform() === 'win32') {
		const cmd = `./clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn "${timestamps}" -dlDir "./download/" -fulltitle ${internalId} -fileOutExt ${fileExt}`;
		exec(cmd, { shell: 'powershell.exe' }, async (error, stdout) => {
			console.log(stdout);
			console.log(error);
			if (error !== null) {
				console.log(error);
				return socket.emit('CLIPPING FAIL', { internalId });
			}
			// WebDAV upload here
			const stream = fs.createReadStream(`./download/${internalId}.${fileExt}`);
			const result = await webdavClient.putFileContents(`/TL Team/Projects/Test/${fileName}.${fileExt}`, stream);
			if (result === false) {
				return socket.emit('UPLOAD FAIL', { internalId });
			}
			fs.unlink(`./download/${internalId}.${fileExt}`, (err) => {
				if (err) console.log(err);
			});
			return socket.emit('PASS', { internalId });
		});
	} else {
		const cmd = `pwsh ./clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn "${timestamps}" -dlDir "./download/" -fulltitle ${internalId} -fileOutExt ${fileExt}`;
		exec(cmd, async (error, stdout) => {
			console.log(stdout);
			console.log(error);
			if (error !== null) {
				console.log(error);
				return socket.emit('FAIL', { internalId });
			}
			// WebDAV upload here
			const stream = fs.createReadStream(`./download/${internalId}.${fileExt}`);
			const result = await webdavClient.putFileContents(`/TL Team/Projects/Test/${fileName}.${fileExt}`, stream);
			if (result === false) {
				return socket.emit('UPLOAD FAIL', { internalId });
			}
			fs.unlink(`./download/${internalId}.${fileExt}`, (err) => {
				if (err) console.log(err);
			});
			return socket.emit('PASS', { internalId });
		});
	}
});
