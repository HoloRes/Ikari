/* eslint-disable max-len */
/* eslint-disable no-console */
// Packages
const { exec } = require('child_process');
const os = require('os');
const io = require('socket.io-client');
const fs = require('fs');

// Local files
const config = require('./config.json');

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
	// eslint-disable-next-line no-unused-vars
	fileName,
	fileExt,
}) => {
	// TODO: Files get saved under internalId as name, make sure to rename when uploading to Nextcloud
	// This OS check is for development purposes only; will be removed in the future
	if (os.platform() === 'win32') {
		const cmd = `./clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn "${timestamps}" -dlDir "." -fulltitle ${internalId} -fileOutExt ${fileExt}`;
		exec(cmd, { shell: 'powershell.exe' }, (error, stdout) => {
			console.log(stdout);
			console.log(error);
			if (error !== null) {
				console.log(error);
				return socket.emit('FAIL', { internalId });
			}
			// WebDAV upload here
			/* fs.unlink(`${fileName}.${fileExt}`, (err) => {
				if (err) console.log(err);
			}); */
			return socket.emit('PASS', { internalId });
		});
	} else {
		const cmd = `pwsh ./clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn "${timestamps}" -dlDir "." -fulltitle ${internalId} -fileOutExt ${fileExt}`;
		exec(cmd, (error, stdout) => {
			console.log(stdout);
			console.log(error);
			if (error !== null) {
				console.log(error);
				return socket.emit('FAIL', { internalId });
			}
			// WebDAV upload here
			/* fs.unlink(`${fileName}.${fileExt}`, (err) => {
				if (err) console.log(err);
			}); */
			return socket.emit('PASS', { internalId });
		});
	}
});
