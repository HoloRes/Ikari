// Packages
const mongoose = require('mongoose');

// Local files
const { AutoIncrement } = require('../index');

// Schema
const ProjectSchema = new mongoose.Schema({
	_id: Number,
	clickUpId: String,
	discordMessageId: String,
}, { _id: false });

ProjectSchema.plugin(AutoIncrement);

module.exports = mongoose.model('Project', ProjectSchema, 'projects');
