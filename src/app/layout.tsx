import type { Metadata } from 'next';
import './globals.css';
import './form-contrast.css';
import './thor-design-system.css';
import './thor-design-final.css';
import './thor-universal-polish.css';
import './thor-responsive-layout.css';
import './fiscal-compact.css';
import './cash-closure-history.css';
import './cash-closure-practical.css';
import { ThorFeedbackCenter } from './thor-feedback-center';

export const metadata: Metadata = {
  title: 'ThorPDV',
  description: 'ERP e frente de caixa SaaS para o varejo brasileiro',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}<ThorFeedbackCenter/></body>
      <script src="/fiscal-compact-v1.js" defer />
      <script src="/admin-permission-hints-v1.js" defer />
    </html>
  );
}
