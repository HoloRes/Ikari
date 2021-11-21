// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

type UserInfo = {
	_id: string;
	lastAssigned: Date;
	isAssigned: boolean;
	assignedTo?: string;
	assignedAs?: string;
	roles: string[];
};

// Schema
const UserInfoSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	lastAssigned: { type: Date, default: new Date(0) },
	isAssigned: { type: Boolean, default: false },
	assignedTo: { type: String },
	assignedAs: { type: String },
	roles: { type: [String], default: [] },
});

export default conn1.model<UserInfo>('UserInfo', UserInfoSchema, 'users');
