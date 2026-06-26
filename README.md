# 💰 DebtFlow

A web-based debt management system built for a client who sells products on installment to acquaintances and needs to track payments with fixed and variable late interest rates.

> **Sold and running in production.**

---

## 📋 About

The client was losing track of who owed what, when each installment was due, and how to correctly calculate late fees — everything was done on paper or scattered notes.

DebtFlow solves this with a simple interface accessible from any device, where the lender manages the entire debtor portfolio.

### Features

- Create and edit debtor profiles
- Register debts with amount, date, and number of installments
- Automatic fixed and variable interest calculation on overdue payments
- Payment history per debtor
- Portfolio overview with totals and status
- Authenticated access — each user sees only their own data

---

## 🛠️ Tech Stack

- **Framework:** Next.js (App Router)
- **Language:** JavaScript
- **Styling:** CSS Modules
- **Deployment:** Vercel

---

## 🚀 Running locally

```bash
git clone https://github.com/CoimbraJP/debtflow-next.git
cd debtflow-next
npm install
cp .env.local.example .env.local
# Fill in the required environment variables
npm run dev
```

Open `http://localhost:3000`

---

## 🌐 Live

[debtflow-next.vercel.app](https://debtflow-next.vercel.app)

---

## 👨‍💻 Author

**João Paulo Coimbra**
[![LinkedIn](https://img.shields.io/badge/LinkedIn-coimbrajp-0A66C2?style=flat&logo=linkedin)](https://www.linkedin.com/in/coimbrajp/)
[![GitHub](https://img.shields.io/badge/GitHub-CoimbraJP-181717?style=flat&logo=github)](https://github.com/CoimbraJP)
