// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

type UserInfo = {
	_id: string;
	lastAssigned: Date;
	isAssigned: false;
} | {
	_id: string;
	lastAssigned: Date;
	isAssigned: true;
	assignedTo: string;
};

// Schema
const UserInfoSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	lastAssigned: { type: Date, default: new Date(0) },
	isAssigned: { type: Boolean, default: false },
	assignedTo: { type: String },
});

export default conn1.model<UserInfo>('UserInfo', UserInfoSchema, 'users');
