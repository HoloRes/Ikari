// Imports
const mongoose = require('mongoose');
const { conn1 } = require('../index');

// Schema
const SettingSchema = new mongoose.Schema({
	_id: String, // Setting name
	value: String,
});

module.exports = conn1.model('Setting', SettingSchema, 'settings');
