import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/theme/theme.css';
import { applyTheme } from '../../ui/theme/mode';
import { App } from './App';

applyTheme(document.documentElement);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
