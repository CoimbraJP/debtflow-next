import './globals.css';

export const metadata = {
  title:       'DebtFlow Admin — Gestão de Cobranças',
  description: 'Sistema de gestão de dívidas com parcelas e cobranças automáticas',
};

export const viewport = {
  width:        'device-width',
  initialScale: 1,
  viewportFit:  'cover', // respeita Dynamic Island / notch iOS
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
