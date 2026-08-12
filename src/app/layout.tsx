import type { Metadata } from 'next';
import './globals.css';
import './form-contrast.css';

export const metadata: Metadata = {
  title: 'ThorPDV',
  description: 'ERP e frente de caixa SaaS para o varejo brasileiro',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
      <script src="/product-image-upload-v090.js" defer />
    </html>
  );
}
