// Modules
const Discord = require('discord.js');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const sequence = require('mongoose-sequence');
const mongoose = require('mongoose');

// Config
const config = require('./config.json');

// Variables

// Mongoose
mongoose.connect(`mongodb+srv://${config.mongodb.username}:${config.mongodb.password}@${config.mongodb.host}/${config.mongodb.database}`, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
	useFindAndModify: false,
});
const AutoIncrement = sequence(mongoose);

exports.AutoIncrement = AutoIncrement;

const client = new Discord.Client({
	partials: ['GUILD_MEMBER', 'MESSAGE', 'REACTION'],
});
exports.client = client;

const server = http.createServer()
	.listen(config['socket.io'].port);

const io = new SocketIO(server, { serveClient: false });
io.use((socket, next) => {
	if (socket.handshake.auth && socket.handshake.auth.token === config['socket.io'].authToken) {
		next();
	} else {
		next(new Error('Socket.io Auth Error'));
	}
})
	.on('connection', (socket) => {
		console.log(`Connected to ${socket.id}`);
	});
exports.io = io;

// Local Files
const { clipRequest } = require('./tools/clipper.js'); // THIS IS HERE FOR A REASON, DO NOT MOVE ABOVE

client.on('ready', () => {
	console.log('READY');
});

client.on('message', (message) => {
	if (message.author.bot || !message.content.startsWith(config.discord.prefix)) return;
	const cmd = message.content.slice(config.discord.prefix.length)
		.split(' ');
	const args = cmd.slice(1);
	// Temporarily keeping all commands here
	// Gonna level with you, most of this is held together with duct tape and prayers atm
	switch (cmd[0]) {
	case 'clip': {
		if (args[0] === 'help' && args[1] === null) {
			// TODO
			message.channel.send('Usage:\nTODO: add usage guide');
			break;
		}
		if (args[4] === 'mkv' || args[4] === 'mp4') {
			clipRequest(message, args);
		} else {
			message.channel.send('Missing or Incorrect Arguments');
		}
		break;
	}
	case 'help': {
		// TODO: Replace i! with prefix
		message.channel.send('Currently Functional Commands:\n```clip - Type "i!clip help" for usage```');
		break;
	}
	default: {
		break;
	}
	}
});

client.login(config.discord.token);
