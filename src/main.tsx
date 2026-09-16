import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// 日本語フォントを同梱 (オフラインでも全 PC で同じ表示になる)
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
