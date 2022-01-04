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
	progressStart?: Date;
	lqcProgressStart?: Date;
	sqcProgressStart?: Date;
	staleCount: number;
	abandoned: boolean;
	requestedTeamLeadAction: boolean;
	// Below is set using bit shifts (1 << k)
	hasAssignment: number;
	inProgress: number;
}

// Schema
const ProjectSchema = new mongoose.Schema<Project>({
	jiraKey: String,
	discordMessageId: String,
	type: { type: String, enum: ['translation', 'artist'], required: true },
	status: { type: String, required: true },
	languages: { type: [String], required: true },
	finished: { type: Boolean, default: false },
	lastUpdate: { type: Date, default: new Date() },
	progressStart: { type: Date },
	lqcProgressStart: { type: Date },
	sqcProgressStart: { type: Date },
	staleCount: { type: Number, default: 0 },
	abandoned: { type: Boolean, default: false },
	requestedTeamLeadAction: { type: Boolean, default: false },
	hasAssignment: { type: Number, default: 0 },
	inProgress: { type: Number, default: 0 },
});

export default conn1.model<Project>('Project', ProjectSchema, 'projects');
