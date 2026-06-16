import mongoose from 'mongoose';

const SettingsSchema = new mongoose.Schema({
  // Documento singleton por tenant: key='global' + tenant='miguel'|'loja'
  key:             { type: String, default: 'global' },
  tenant:          { type: String, required: true },
  apiUrl:          { type: String, default: '' },
  instance:        { type: String, default: '' },
  apiKey:          { type: String, default: '' },
  defaultInterest: { type: Number, default: 10 },
  msgTemplate: {
    type: String,
    default: 'Olá {nome}! 👋 Passando para lembrar que sua parcela referente a *{produto}* no valor de *R$ {valor}* vence em *{vencimento}*. Por favor, efetue o pagamento para evitar juros de atraso. Obrigado! 🙏',
  },
  msgOverdue: {
    type: String,
    default: 'Olá {nome}! Identificamos que a parcela {parcela}/{total_parcelas} referente a *{produto}* no valor de *R$ {valor}* está em *atraso* há {dias_atraso} dia(s). O novo valor com juros é *R$ {valor_com_juros}*. Entre em contato para regularizar sua situação. 😊',
  },
}, {
  timestamps: true,
  toJSON: {
    transform: (_, ret) => {
      delete ret._id;
      delete ret.__v;
      delete ret.key;
      delete ret.tenant;
      return ret;
    },
  },
});

// Índice único composto: um documento de settings por tenant
SettingsSchema.index({ key: 1, tenant: 1 }, { unique: true });

export const Settings = mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);
