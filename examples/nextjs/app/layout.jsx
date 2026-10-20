import '@pagesquire/client/widget.css';
import Assistant from './assistant.jsx';
export const metadata = { title: 'PageSquire Next.js fixture' };
export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Assistant />
      </body>
    </html>
  );
}
