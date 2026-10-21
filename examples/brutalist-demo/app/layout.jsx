import './style.css';
import '../../../packages/client/src/widget.css';

export const metadata = {
  title: 'OFFBEAT — Weird looks good on you',
  description:
    'A little internet escape for character art, loud ideas, and beautifully weird creative energy. An interactive PageSquire demo.',
  robots: { index: true, follow: true },
  icons: { icon: '/icon.svg' },
};

export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
