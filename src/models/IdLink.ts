// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

export interface Project {
	jiraKey?: string;
	discordMessageId?: string;
	type: 'translation' | 'artist';
	status: string;
	languages: string[];
	finished: boolean;
	lastUpdate: Date;
	lastStatusChange: Date;
	lqcLastUpdate?: Date;
	sqcLastUpdate?: Date;
	staleCount: number;
	abandoned: boolean;
	// Below is set using bit shifts (1 << k)
	updateRequest: number;
	hasAssignment: number;
}

// Schema
const ProjectSchema = new mongoose.Schema({
	jiraKey: String,
	discordMessageId: String,
	type: { type: String, enum: ['translation', 'artist'], required: true },
	status: { type: String, required: true },
	languages: { type: [String], required: true },
	finished: { type: Boolean, default: false },
	lastUpdate: { type: Date, default: new Date() },
	lastStatusChange: { type: Date },
	lqcLastUpdate: { type: Date },
	sqcLastUpdate: { type: Date },
	staleCount: { type: Number, default: 0 },
	abandoned: { type: Boolean, default: false },
	updateRequest: { type: Number, default: 0 },
	hasAssignment: { type: Number, default: 0 },
});

export default conn1.model<Project>('Project', ProjectSchema, 'projects');
