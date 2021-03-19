// Imports
const mongoose = require('mongoose');
const { conn2 } = require('../index');

// Schema
const GroupLinkSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	jiraName: { type: String, required: true },
	baseRole: { type: Boolean, default: false },
});

module.exports = conn2.model('GroupLink', GroupLinkSchema, 'groups');
