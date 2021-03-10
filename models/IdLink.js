// Imports
const mongoose = require('mongoose');

// Schema
const ProjectSchema = new mongoose.Schema({
	jiraId: String,
	discordMessageId: String,
});

module.exports = mongoose.model('Project', ProjectSchema, 'projects');
