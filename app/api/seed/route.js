import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { Debt } from '@/lib/models/Debt';

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

const ruas = ["das Flores","Sete de Setembro","XV de Novembro","do Comércio","Central","São João","Marechal Deodoro"];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randN(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function genInstallments(total, n, dueDay, createdStr, statusType) {
  const instVal = parseFloat((total / n).toFixed(2));
  const base    = new Date(createdStr + 'T00:00:00Z');
  const today   = new Date();
  const list    = [];

  for (let i = 0; i < n; i++) {
    const due = new Date(base);
    due.setUTCMonth(base.getUTCMonth() + i);
    due.setUTCDate(dueDay);
    if (due.getUTCDate() !== dueDay) due.setUTCDate(0);
    const dueStr = due.toISOString().slice(0, 10);

    let status = 'pending', paidDate = null, paidAmount = null;
    if (statusType === 'paid') { status = 'paid'; paidDate = dueStr; paidAmount = instVal; }
    else if (statusType === 'overdue' && due < today) { status = 'overdue'; }

    list.push({
      number: i + 1, value: instVal, originalValue: instVal, dueDate: dueStr,
      status, isPenalty: false, penaltyRate: 0, penaltyApplied: false,
      dueSent: false, overdueSent: false, paidDate, paidAmount, carriedInterest: 0,
    });
  }
  return list;
}

export async function GET(request) {
  const secret = new URL(request.url).searchParams.get('secret');
  if (secret !== 'seed-miguel-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();

  const totais       = [320,480,750,900,1100,1400,1800,2200,2700,3300,4000,5000];
  const parcelasOpts = [3,4,5,6,8,10,12];
  const taxas        = [5,8,10,12,15];
  const dias         = [5,10,15,20,25];
  const statusPool   = ['pending','pending','pending','overdue','overdue','paid'];

  const docs = nomes.map((nome, i) => {
    const total      = rand(totais);
    const parcelas   = rand(parcelasOpts);
    const dueDay     = rand(dias);
    const rate       = rand(taxas);
    const statusType = statusPool[i % statusPool.length];
    const month      = String(randN(1, 5)).padStart(2, '0');
    const day        = String(randN(1, 28)).padStart(2, '0');
    const createdStr = `2026-${month}-${day}`;

    return {
      tenant: 'miguel',
      name: nome,
      phone: `5511${randN(900000000, 999999999)}`,
      address: `Rua ${rand(ruas)}, ${randN(10, 999)} — São Paulo/SP`,
      product: rand(produtos),
      total, installments: parcelas, dueDay, interestRate: rate, notes: '',
      status: statusType === 'paid' ? 'paid' : statusType === 'overdue' ? 'overdue' : 'pending',
      installmentList: genInstallments(total, parcelas, dueDay, createdStr, statusType),
      createdAt: new Date(createdStr + 'T00:00:00Z'),
    };
  });

  await Debt.insertMany(docs);

  return NextResponse.json({ ok: true, inserted: docs.length, names: docs.map(d => d.name) });
}
