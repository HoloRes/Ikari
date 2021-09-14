// Imports
import mongoose from 'mongoose'
import { conn1 } from '../index';

interface Setting {
	_id: string;
	value: string;
}

// Schema
const SettingSchema = new mongoose.Schema({
	_id: String, // Setting name
	value: String,
});

export default conn1.model<Setting>('Setting', SettingSchema, 'settings');
