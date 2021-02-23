/* eslint-disable max-len */
/* eslint-disable no-console */
// Packages
const dl = require('delivery');
const { Server: SocketIO } = require('socket.io');
const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');

// Local files
const config = require('./config.json');

const server = http.createServer().listen(config.port);

const io = new SocketIO(server, { serveClient: true });
io.use((socket, next) => {
	if (socket.handshake.auth && socket.handshake.auth.token === config.authToken) next();
	else next(new Error('AUTH ERROR'));
}).on('connection', (socket) => {
	console.log(socket.id);
	const delivery = dl.listen(socket);
	socket.on('request', (videoType, videoLink, timestamps, fileName, fileExt) => {
		console.log('REGISTERED');
		// exec(`pwsh ./tools/clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn ${timestamps} -dlDir "." -fulltitle ${fileName} -fileOutExt ${fileExt}`, (error, stdout) => {
		exec(`./tools/clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn ${timestamps} -dlDir "." -fulltitle ${fileName} -fileOutExt ${fileExt}`, { shell: 'powershell.exe' }, (error, stdout) => {
			console.log(stdout);
			const clippedFileStats = fs.statSync(`${fileName}.${fileExt}`);
			console.log(clippedFileStats.size / (1024 * 1024));
			if (error !== null) {
				console.log(error);
				return socket.emit('FAIL');
			}
			delivery.connect();
			delivery.on('delivery.connect', () => {
				delivery.send({
					name: `${fileName}.${fileExt}`,
					path: `./${fileName}.${fileExt}`,
				});
			});
			delivery.on('send.success', () => {
				console.log('File sent successfully!');
				fs.unlink(`${fileName}.${fileExt}`, (err) => {
					if (err) console.log(err);
				});
			});
			return 0;
		});
	});
});
