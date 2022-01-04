// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

type UserInfo = {
	_id: string;
	lastAssigned: Date;
	isAssigned: boolean;
	assignedTo?: string;
	assignedAs?: string;
	updateRequested?: Date;
	updateRequestCount: number;
	roles: string[];
};

// Schema
const UserInfoSchema = new mongoose.Schema<UserInfo>({
	_id: { type: String, required: true },
	lastAssigned: { type: Date, default: new Date(0) },
	isAssigned: { type: Boolean, default: false },
	assignedTo: { type: String },
	assignedAs: { type: String },
	updateRequested: { type: Date },
	updateRequestCount: { type: Number, default: 0 },
	roles: { type: [String], default: [] },
});

export default conn1.model<UserInfo>('UserInfo', UserInfoSchema, 'users');
