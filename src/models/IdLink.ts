// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

interface Project {
	jiraId?: string;
	discordMessageId?: string;
	type: 'translation'|'artist';
	finished: boolean;
}

// Schema
const ProjectSchema = new mongoose.Schema({
	jiraId: String,
	discordMessageId: String,
	type: { type: String, enum: ['translation', 'artist'], required: true },
	finished: { type: Boolean, default: false },
});

export default conn1.model<Project>('Project', ProjectSchema, 'projects');
