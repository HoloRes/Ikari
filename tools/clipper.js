/* eslint-disable no-console */
const { exec } = require('child_process');

function clipVideo(videoLink, videoType, timestamps, fileExt) {
	console.log('REGISTERED');
	exec(`pwsh ./tools/clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn ${timestamps} -fileOutExt ${fileExt} -fulltitle TEST -dlDir "."`, (error, stdout) => {
		console.log(stdout);
		if (error !== null) {
			console.log(`exec error: ${error}`);
		}
	});
}
module.exports = { clipVideo };
