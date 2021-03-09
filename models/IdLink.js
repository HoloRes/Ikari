// Imports
const mongoose = require('mongoose');

// Schema
const ProjectSchema = new mongoose.Schema({
	jiraKey: String,
	discordMessageId: String,
});

module.exports = mongoose.model('Project', ProjectSchema, 'projects');
