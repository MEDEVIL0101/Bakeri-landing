import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// GitHub Pages has no server-side routing: a deep link like /app/orders/123
// falls through to the site's root 404.html, which bounces it here as
// /app/?r=<path+query>. Restore the real URL before the router reads it.
const r = new URLSearchParams(window.location.search).get('r');
if (r && r.startsWith('/')) {
  window.history.replaceState(null, '', `${import.meta.env.BASE_URL.replace(/\/$/, '')}${r}${window.location.hash}`);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
