// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

interface StatusLink {
	_id: string;
	channel: string;
}

// Schema
const StatusLinkSchema = new mongoose.Schema<StatusLink>({
	_id: { type: String, required: true },
	channel: { type: String, required: true },
});

export default conn1.model<StatusLink>('StatusLink', StatusLinkSchema, 'statusLinks');
