import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LImax AI Manager',
  description: 'AI Sales Manager Dashboard',
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
