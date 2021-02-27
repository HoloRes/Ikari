/* eslint-disable no-console */
const { nanoid } = require('nanoid');
const { io } = require('../index.js');

const idRegex = /(\?v=|be\/).{11}/g;

function clipRequest(message, [videoType, videoLink, timestamps, fileName, fileExt]) {
	const id = videoLink.match(idRegex)[0].substring(3);

	// eslint-disable-next-line max-len
	// TODO: Instead of nano id, use ClickUp's internal ID
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
	socket.on('PASS', (data) => {
		// TODO: ClickUp update status to DONE
		console.log('Clipping Succeeded', data.internalId);
	});

	socket.on('FAIL', (data) => {
		// TODO: ClickUp update status to FAILED
		console.log('Clipping Failed', data.internalId);
	});
});
