import mongoose from 'mongoose';

const InstallmentSchema = new mongoose.Schema({
  number:         { type: Number, required: true },
  value:          { type: Number, required: true },
  originalValue:  { type: Number, required: true },
  dueDate:        { type: String, required: true },
  status:         { type: String, enum: ['pending', 'paid', 'overdue', 'partial', 'skipped'], default: 'pending' },
  isPenalty:      { type: Boolean, default: false },
  penaltyRate:    { type: Number, default: 0 },
  penaltyApplied: { type: Boolean, default: false },
  dueSent:        { type: Boolean, default: false },
  overdueSent:    { type: Boolean, default: false },
  paidDate:       { type: String, default: null },
  paidAmount:     { type: Number, default: null },
}, { _id: false });

const DebtSchema = new mongoose.Schema({
  tenant:          { type: String, required: true, index: true },   // 'miguel' | 'loja'
  name:            { type: String, required: true, trim: true },
  phone:           { type: String, default: '' },
  address:         { type: String, default: '' },                   // endereço
  product:         { type: String, required: true, trim: true },
  total:           { type: Number, required: true, min: 0.01 },
  installments:    { type: Number, required: true, min: 1 },
  dueDay:          { type: Number, required: true, min: 1, max: 28 },
  interestRate:    { type: Number, default: 10 },
  notes:           { type: String, default: '' },
  status:          { type: String, enum: ['pending', 'overdue', 'paid'], default: 'pending' },
  installmentList: [InstallmentSchema],
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, ret) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
});

export 