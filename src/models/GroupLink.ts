// Imports
import mongoose from 'mongoose';
import { conn2 } from '../index';

interface GroupLink {
	_id: string;
	jiraName: string;
	baseRole: boolean;
}

// Schema
const GroupLinkSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	jiraName: { type: String, required: true },
	baseRole: { type: Boolean, default: false },
});

export default conn2.model<GroupLink>('GroupLink', GroupLinkSchema, 'groups');
