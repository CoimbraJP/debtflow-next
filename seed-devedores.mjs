// seed-devedores.mjs — rode com: node seed-devedores.mjs
import { MongoClient } from 'mongodb';

const URI    = "mongodb+srv://miguelcastrocrlm_db_user:L717SsaLFXH8rP8g@cluster0.lpplvuu.mongodb.net/debtflow?appName=Cluster0";
const TENANT = "miguel";

const nomes = [
  "Ana Beatriz Santos","Carlos Eduardo Lima","Fernanda Oliveira","Roberto Alves","Juliana Costa",
  "Marcos Pereira","Patricia Silva","Diego Rodrigues","Camila Ferreira","Lucas Nascimento",
  "Bianca Souza","Rafael Mendes","Isabela Carvalho","Thiago Martins","Larissa Gomes",
  "Bruno Araújo","Natalia Ribeiro","Felipe Barros","Aline Machado","Gustavo Azevedo",
  "Vanessa Moreira","Anderson Lopes","Simone Castro","Renato Freitas","Daniela Pinto",
  "Fábio Cunha","Leticia Nunes","Rodrigo Vieira","Mariana Campos","Eduardo Teixeira",
];

const produtos = [
  "Geladeira Brastemp","Fogão 4 bocas","TV 55\" Samsung","Notebook Dell","Sofá 3 lugares",
  "Ar Condicionado 12mil BTU","Máquina de Lavar","Microondas Eletrolux","iPhone 14","Colchão Castor",
  "Guarda-Roupa 6 portas","Console PS5","Tablet iPad","Impressora HP","Churrasqueira a Gás",
  "Aspirador Robô","Smartwatch Apple","Drone DJI","Batedeira KitchenAid","Sound Bar JBL",
  "Câmera DSLR Nikon","Bicicleta Elétrica","Projetor Epson","Liquidificador Philips","Monitor LG 27\"",
];

const ruas = ["das Flores","Sete de Setembro","XV de Novembro","do Comércio","Central","São João","Marechal Deodoro","das Palmeiras"];

const rand  = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randN = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function genInstallments(total, n, dueDay, createdStr, statusType) {
  const instVal = parseFloat((total / n).toFixed(2));
  const base    = new Date(createdStr + 'T00:00:00Z');
  const today   = new Date('2026-06-17T00:00:00Z');
  const list    = [];

  for (let i = 0; i < n; i++) {
    const due = new Date(base);
    due.setUTCMonth(base.getUTCMonth() + i);
    due.setUTCDate(dueDay);
    if (due.getUTCDate() !== dueDay) due.setUTCDate(0); // overflow → último dia do mês
    const dueStr = due.toISOString().slice(0, 10);

    let status = 'pending', paidDate = null, paidAmount = null;

    if (statusType === 'paid') {
      status = 'paid'; paidDate = dueStr; paidAmount = instVal;
    } else if (statusType === 'overdue') {
      status = due < today ? 'overdue' : 'pending';
    }
    // 'pending' → mantém pending para tudo

    list.push({
      number: i + 1, value: instVal, originalValue: instVal, dueDate: dueStr,
      status, isPenalty: false, penaltyRate: 0, penaltyApplied: false,
      dueSent: false, overdueSent: false, paidDate, paidAmount, carriedInterest: 0,
    });
  }
  return list;
}

const statusPool = ['pending','pending','pending','overdue','overdue','paid'];
const totais     = [320,480,750,900,1100,1400,1800,2200,2700,3300,4000,5000];
const parcelasOpts = [3,4,5,6,8,10,12];
const taxas      = [5,8,10,12,15];
const dias       = [5,10,15,20,25];

async function seed() {
  console.log('🔌 Conectando ao MongoDB Atlas...');
  const client = new MongoClient(URI);
  await client.connect();
  console.log('✅ Conectado!');

  const col = client.db('debtflow').collection('debts');

  const docs = nomes.map((nome, i) => {
    const total      = rand(totais);
    const parcelas   = rand(parcelasOpts);
    const dueDay     = rand(dias);
    const rate       = rand(taxas);
    const statusType = statusPool[i % statusPool.length];
    const month      = String(randN(1, 5)).padStart(2, '0');
    const day        = String(randN(1, 28)).padStart(2, '0');
    const createdStr = `2026-${month}-${day}`;
    const created    = new Date(createdStr + 'T00:00:00Z');

    return {
      tenant: TENANT,
      name: nome,
      phone: `5511${randN(900000000, 999999999)}`,
      address: `Rua ${rand(ruas)}, ${randN(10, 999)} — São Paulo/SP`,
      product: rand(produtos),
      total, installments: parcelas, dueDay, interestRate: rate, notes: '',
      status: statusType === 'paid' ? 'paid' : statusType === 'overdue' ? 'overdue' : 'pending',
      installmentList: genInstallments(total, parcelas, dueDay, createdStr, statusType),
      createdAt: created, updatedAt: created,
    };
  });

  const res = await col.insertMany(docs);
  console.log(`🎉 ${res.insertedCount} devedores inseridos no tenant '${TENANT}'`);
  await client.close();
}

seed().catch(e => { console.error('❌ Erro:', e.message); process.exit(1); });
