import './globals.css';

export const metadata = {
  title:       'DebtFlow Admin — Gestão de Cobranças',
  description: 'Sistema de gestão de dívidas com parcelas e cobranças automáticas',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
