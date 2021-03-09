// Imports
const mongoose = require('mongoose');

// Schema
const SettingSchema = new mongoose.Schema({
	setting: String,
	value: String,
});

module.exports = mongoose.model('Setting', SettingSchema, 'settings');
