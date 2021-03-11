// Packages
const mongoose = require('mongoose');

// Schema
const UserSchema = new mongoose.Schema({
	_id: String,
	clickUpId: String,
});

module.exports = mongoose.model('User', UserSchema, 'users');
