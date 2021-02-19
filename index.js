// Packages
const io = require('socket.io-client');
const { exec } = require('child_process');
const fs = require('fs');

// Local files
const config = require('./config.json');

const socket = io(config.host, {
	auth: {
		token: config.authToken,
	},
});

/* eslint-disable no-console */
socket.on('request', ({
	videoType, videoLink, timestamps, fileName, fileExt, id,
}) => {
	exec(`pwsh ./tools/clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn ${timestamps} -dlDir "." -fulltitle ${fileName} -fileOutExt ${fileExt}`, (error, stdout) => {
		console.log(stdout);
		const clippedFileStats = fs.statSync(`${fileName}.${fileExt}`);
		console.log(clippedFileStats.size / (1024 * 1024));
		if (error !== null) {
			console.log(error);
			return socket.emit({ code: 1 });
		}
		return socket.emit(id, { code: 0, files: [`${fileName}.${fileExt}`] })
			.then(() => fs.unlink(`${fileName}.${fileExt}`, (err) => {
				if (err) console.log(err);
			}));
	});
});
