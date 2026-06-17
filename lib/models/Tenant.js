import mongoose from 'mongoose';

const TenantSchema = new mongoose.Schema({
  tenant:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:         { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true });

export const Tenant = mongoose.models.Tenant || mongoose.model('Tenant', TenantSchema);
