/* eslint-disable no-console */
const { nanoid } = require('nanoid');
const { io } = require('../index.js');

const idRegex = /(\?v=|be\/).{11}/g;

function clipRequest(message, [videoType, videoLink, timestamps, fileName, fileExt]) {
	console.log('WEEEE');
	const id = videoLink.match(idRegex)[0].substring(3);

	// eslint-disable-next-line max-len
	// TODO: Internal id needs to be saved somewhere, with an additional nanoid just to make sure the same id doesn't exists twice
	io.emit('request', {
		internalId: `${id}_${nanoid()}`,
		videoType,
		videoLink,
		timestamps,
		fileName,
		fileExt,
	});
}
exports.clipRequest = clipRequest;

io.on('connection', (socket) => {
	// eslint-disable-next-line no-unused-vars
	socket.on('PASS', (data) => {
		// TODO: Data should have the internalId
		console.log('Clipping Succeeded');
	});

	socket.on('FAIL', () => {
		console.log('Clipping Failed');
	});
});
