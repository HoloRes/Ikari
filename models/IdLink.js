// Imports
const mongoose = require('mongoose');
const { conn1 } = require('../index');

// Schema
const ProjectSchema = new mongoose.Schema({
	jiraId: String,
	discordMessageId: String,
	type: { type: String, enum: ['translation', 'artist'], required: true },
	finished: { type: Boolean, default: false },
});

module.exports = conn1.model('Project', ProjectSchema, 'projects');
