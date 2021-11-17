// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

export interface Project {
	jiraId?: string;
	discordMessageId?: string;
	type: 'translation' | 'artist';
	status: string;
	finished: boolean;
	lastUpdate: Date;
	lqcLastUpdate?: Date;
	sqcLastUpdate?: Date;
	staleCount: number;
	// Below is set using bit shifts (1 << k)
	updateRequest: number;
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
	sqcLastUpdate: { type: Date },
	staleCount: { type: Number, default: 0 },
	updateRequest: { type: Number, default: 0 },
});

export default conn1.model<Project>('Project', ProjectSchema, 'projects');
