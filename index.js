/* eslint-disable max-len */
/* eslint-disable no-console */
// Packages
const { exec } = require('child_process');
const os = require('os');
const io = require('socket.io-client');
const fs = require('fs');
const createWebdavClient = require('webdav');

// Local files
const config = require('./config.json');

const webdavClient = createWebdavClient(
	'nextcloud link',
	{
		// auth here
	},
);

const socket = io(config.host, {
	auth: {
		token: config.authToken,
	},
});

socket.on('connect', () => {
	console.log('Connected!');
});

socket.on('request', ({
	internalId,
	videoType,
	videoLink,
	timestamps,
	fileName,
	fileExt,
}) => {
	if (webdavClient.exists('/projects/folder') === false) {
		webdavClient.createDirectory('/projects/folder');
	}
	// This OS check is for development purposes only; will be removed in the future
	if (os.platform() === 'win32') {
		const cmd = `./clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn "${timestamps}" -dlDir "./download/" -fulltitle ${internalId} -fileOutExt ${fileExt}`;
		exec(cmd, { shell: 'powershell.exe' }, (error, stdout) => {
			console.log(stdout);
			console.log(error);
			if (error !== null) {
				console.log(error);
				return socket.emit('FAIL', { internalId });
			}
			// WebDAV upload here
			const readStream = fs.createReadStream(`./download/${internalId}.${fileExt}`);
			webdavClient.putFileContents(`/projects/folder/${fileName}.${fileExt}`, readStream)
				.then(fs.unlink(`${internalId}.${fileExt}`, (err) => {
					if (err) console.log(err);
				}));
			return socket.emit('PASS', { internalId });
		});
	} else {
		const cmd = `pwsh ./clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn "${timestamps}" -dlDir "./download/" -fulltitle ${internalId} -fileOutExt ${fileExt}`;
		exec(cmd, (error, stdout) => {
			console.log(stdout);
			console.log(error);
			if (error !== null) {
				console.log(error);
				return socket.emit('FAIL', { internalId });
			}
			// WebDAV upload here
			const readStream = fs.createReadStream(`./download/${internalId}.${fileExt}`);
			webdavClient.putFileContents(`/projects/folder/${fileName}.${fileExt}`, readStream)
				.then(fs.unlink(`${internalId}.${fileExt}`, (err) => {
					if (err) console.log(err);
				}));
			return socket.emit('PASS', { internalId });
		});
	}
});
