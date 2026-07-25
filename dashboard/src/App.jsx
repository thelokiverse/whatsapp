import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getToken } from './api';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import OnboardingWizard from './components/OnboardingWizard';
import PlanReview from './components/PlanReview';
import AppShell from './components/AppShell';
import './App.css';

function ProtectedRoute({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="onboard" element={<OnboardingWizard />} />
          <Route path="recipients/:id/plan" element={<PlanReview />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
