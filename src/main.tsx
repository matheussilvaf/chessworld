import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx';
import { AdminPage } from './components/admin/AdminPage.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<App />} />
    </Routes>
  </BrowserRouter>
);
