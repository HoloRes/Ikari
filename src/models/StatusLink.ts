// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

interface StatusLink {
	_id: string;
	role: string;
	channel: string;
}

// Schema
const StatusLinkSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	role: { type: String, required: true },
	channel: { type: String, required: true },
});

export default conn1.model<StatusLink>('StatusLink', StatusLinkSchema, 'statusLinks');
