import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from '@/components/ui/toast';
import './index.css';
import App from './App';
import { AuthProvider } from './contexts/auth-context';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initPageStateManager } from './lib/utils/page-state-manager';

function Root() {
  React.useEffect(() => {
    const cleanup = initPageStateManager();
    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <TooltipProvider>
    <AuthProvider>
      <App />
      <Toaster />
    </AuthProvider>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <Root />
  </BrowserRouter>,
);
