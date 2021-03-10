// Imports
const mongoose = require('mongoose');

// Schema
const SettingSchema = new mongoose.Schema({
	_id: String, // Setting name
	value: String,
});

module.exports = mongoose.model('Setting', SettingSchema, 'settings');
