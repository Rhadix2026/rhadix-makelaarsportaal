import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import { Navigatie, Pagina } from './onderdelen/basis.tsx';
import { StatusPagina } from './Status.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Navigatie rechts={<span className="nav-label">Lokaal · 127.0.0.1</span>} />
    <Pagina>
      <StatusPagina />
    </Pagina>
  </StrictMode>,
);
