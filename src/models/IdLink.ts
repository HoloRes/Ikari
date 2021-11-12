// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

interface Project {
	jiraId?: string;
	discordMessageId?: string;
	type: 'translation' | 'artist';
	status: string;
	finished: boolean;
	lastUpdate: Date;
	lqcLastUpdate?: Date;
	subqcLastUpdate?: Date;
	staleCount: number;
}

// Schema
const ProjectSchema = new mongoose.Schema({
	jiraId: String,
	discordMessageId: String,
	type: { type: String, enum: ['translation', 'artist'], required: true },
	status: { type: String, required: true },
	finished: { type: Boolean, default: false },
	lastUpdate: { type: Date, default: new Date() },
	lqcLastUpdate: { type: Date },
	subqcLastUpdate: { type: Date },
	staleCount: { type: Number, default: 0 },
});

export default conn1.model<Project>('Project', ProjectSchema, 'projects');
