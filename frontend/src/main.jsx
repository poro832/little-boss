import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
import { registerServiceWorker } from './lib/push';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

// 렌더를 막지 않도록 등록은 뒤로 미룬다. 실패해도 앱은 그대로 동작한다.
window.addEventListener('load', () => { registerServiceWorker(); });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>
);
