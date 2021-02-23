/* eslint-disable no-console */
const fs = require('fs');
const dl = require('delivery');
const io = require('socket.io-client');

const config = require('../config.json');

const socket = io(config['socket.io'].host, {
	auth: {
		token: config['socket.io'].authToken,
	},
});

const delivery = dl.listen(socket);
delivery.on('receive.success', (file) => {
	fs.writeFile(file.name, file.buffer, (err) => {
		if (err) {
			console.log(err);
		} else {
			console.log(`FILE ${file.name} SAVED`);
		}
	});
});

function clipVideo(videoType, videoLink, timestamps, fileName, fileExt) {
	socket.emit('request', videoType, videoLink, timestamps, fileName, fileExt);
	socket.on('FAIL', () => {
		console.log('Clipping Failed');
	});
}
module.exports = { clipVideo };
