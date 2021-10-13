// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

interface UserInfo {
	_id: string;
	lastAssigned: Date;
}

// Schema
const UserInfoSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	lastAssigned: { type: Date, default: new Date(0) },
});

export default conn1.model<UserInfo>('UserInfo', UserInfoSchema, 'users');
