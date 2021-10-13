// Imports
import mongoose from 'mongoose';
import { conn1 } from '../index';

interface RoleLink {
	_id: string;
	discordChannelId: string;
}

// Schema
const RoleLinkSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	discordChannelId: { type: String, required: true },
});

export default conn1.model<RoleLink>('RoleLink', RoleLinkSchema, 'roleLinks');
