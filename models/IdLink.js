// Packages
const mongoose = require('mongoose');

// Local files
const { AutoIncrement } = require('../index');

// Schema
const LogSchema = new mongoose.Schema({
	_id: Number,
	clickUpId: String,
	discordMessageId: String,
}, { _id: false });

LogSchema.plugin(AutoIncrement);

module.exports = mongoose.model('ModLogItem', LogSchema, 'modlog');
