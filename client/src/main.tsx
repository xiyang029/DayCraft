import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import './index.css';
import App from './App';
import { AuthProvider } from './contexts/auth-context';
import { initPageStateManager } from './lib/utils/page-state-manager';

function Root() {
  React.useEffect(() => {
    const cleanup = initPageStateManager();
    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <AuthProvider>
      <App />
      <Toaster position="top-right" />
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Root />
  </BrowserRouter>,
);
