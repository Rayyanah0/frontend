import type { Metadata, Viewport } from 'next';
import { PreviewBanner } from '../components/PreviewBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zenith Options',
  description: 'Advanced options trading platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PreviewBanner />
        <div>{children}</div>
      </body>
    </html>
  );
}
