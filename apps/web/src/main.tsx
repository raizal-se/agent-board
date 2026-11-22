import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@excalidraw/excalidraw/index.css';
import './styles.css';
import { App } from './App';
import { connectBoard } from './board/connection';

const conn = connectBoard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App conn={conn} />
  </StrictMode>,
);
