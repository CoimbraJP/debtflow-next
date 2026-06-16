import mongoose from 'mongoose';

const ActivitySchema = new mongoose.Schema({
  tenant: { type: String, required: true, index: true },   // 'miguel' | 'loja'
  text:   { type: String, required: true },
  type:   { type: String, enum: ['info', 'success', 'warning', 'danger'], default: 'info' },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, ret) => {
      ret.id = ret._id.toString();
      ret.ts = ret.createdAt;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
});

export const Activity = mongoose.models.Activity || mongoose.model('Activity', ActivitySchema);
