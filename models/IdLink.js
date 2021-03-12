// Imports
const mongoose = require('mongoose');
const { conn1 } = require('../index');

// Schema
const ProjectSchema = new mongoose.Schema({
	jiraId: String,
	discordMessageId: String,
});

module.exports = conn1.model('Project', ProjectSchema, 'projects');
