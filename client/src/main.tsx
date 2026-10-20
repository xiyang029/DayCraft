import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from '@/components/ui/toast';
import './index.css';
import App from './App';
import { AuthProvider } from './contexts/auth-context';
import { TooltipProvider } from '@/components/ui/tooltip';

function Root() {
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
  <BrowserRouter>
    <Root />
  </BrowserRouter>,
);
