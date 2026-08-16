import type { Metadata } from 'next';
import './globals.css';
import './data.css';

export const metadata: Metadata = {
  title: 'LImax AI Manager',
  description: 'LImax savdo, Telegram va AI boshqaruv markazi',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uz">
      <body>{children}</body>
    </html>
  );
}
