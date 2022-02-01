// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

interface UserInfo {
	_id: string;
	lastAssigned: Date;
	assignedTo: string[];
	assignedAs: Map<string, string>;
	updateRequested: Map<string, Date>;
	updateRequestCount: Map<string, number>;
	roles: string[];
}

// Schema
const UserInfoSchema = new mongoose.Schema<UserInfo>({
	_id: { type: String, required: true },
	lastAssigned: { type: Date, default: new Date(0) },
	assignedTo: { type: [String], default: [] },
	assignedAs: { type: Map, of: String, default: new Map<string, string>() },
	updateRequested: { type: Map, of: Date, default: new Map<string, Date>() },
	updateRequestCount: { type: Map, of: Number, default: new Map<string, number>() },
	roles: { type: [String], default: [] },
});

export default conn1.model<UserInfo>('UserInfo', UserInfoSchema, 'users');
