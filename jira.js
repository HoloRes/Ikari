// Imports
const { Router } = require('express');
const axios = require('axios');

// Local files
const config = require('./config.json');

// Init
const router = Router();
exports.router = router;

// Routes
router.post('/webhook', (req, res) => {
	console.log(JSON.stringify(req.body, null, 2));
	res.status(200).end();
});

// Event handlers
exports.messageReactionAdd = (message, user) => {

};
