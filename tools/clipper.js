/* eslint-disable no-console */
const { io } = require('../index.js');

function clipRequest(videoType, videoLink, timestamps, fileName, fileExt) {
	console.log('WEEEE');
	io.emit('request', videoType, videoLink, timestamps, fileName, fileExt);
}
exports.clipRequest = clipRequest;

io.on('connection', (socket) => {
	socket.on('PASS', () => {
		console.log('Clipping Succeeded');
	});

	socket.on('FAIL', () => {
		console.log('Clipping Failed');
	});
});
