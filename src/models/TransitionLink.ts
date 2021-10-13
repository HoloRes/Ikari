// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

interface TransitionLink {
	_id: string;
	discordChannelId: string;
}

// Schema
const TransitionLinkSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	discordChannelId: { type: String, required: true },
});

export default conn1.model<TransitionLink>('TransitionLink', TransitionLinkSchema, 'transition-links');
