/* eslint-disable no-console */
const { exec } = require('child_process');
const fs = require('fs');

function clipVideo(videoType, videoLink, timestamps, fileName, fileExt, message) {
	console.log('REGISTERED');
	exec(`pwsh ./tools/clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn ${timestamps} -dlDir "." -fulltitle ${fileName} -fileOutExt ${fileExt}`, (error, stdout) => {
		console.log(stdout);
		const clippedFileStats = fs.statSync(`${fileName}.${fileExt}`);
		console.log(clippedFileStats.size / (1024 * 1024));
		if (error !== null) {
			console.log(`exec error: ${error}`);
		}
		if ((clippedFileStats.size / (1024 * 1024)) >= 8) {
			message.channel.send('Clipped File Too Large, Cannot Send VIA Discord')
				.then(() => fs.unlink(`${fileName}.${fileExt}`, (err) => {
					if (err) console.log(err);
				}));
		} else {
			message.channel.send('Clipped File:', { files: [`${fileName}.${fileExt}`] })
				.then(() => fs.unlink(`${fileName}.${fileExt}`, (err) => {
					if (err) console.log(err);
				}));
		}
	});
}
module.exports = { clipVideo };
