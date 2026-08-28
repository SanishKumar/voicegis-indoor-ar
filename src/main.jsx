import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '#voicegis-app';
import './index.css';
import { registerOfflineWorker } from './offline/offlineAvailability.ts';

if (import.meta.env.PROD && import.meta.env.MODE === 'public') {
  void registerOfflineWorker();
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
