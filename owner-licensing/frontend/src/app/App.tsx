import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from './providers';
import { AppRoutes } from './router';

/** Composition root: providers + router. No feature logic lives here. */
export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
