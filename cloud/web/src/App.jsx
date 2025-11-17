import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { getSession, setSession as persistSession } from './api/client';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import MapPage from './pages/MapPage';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';

// Protected Route Component
function ProtectedRoute({ children, role, requiredRole }) {
  if (requiredRole === 'admin' && role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

export default function App() {
  const [session, setSessionState] = useState(getSession());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check session on mount
    const savedSession = getSession();
    setSessionState(savedSession);
    setLoading(false);
  }, []);

  const handleLogin = (newSession) => {
    persistSession(newSession);
    setSessionState(newSession);
  };

  const handleSignOut = () => {
    const nextSession = { token: '', role: 'user' };
    persistSession(nextSession);
    setSessionState(nextSession);
  };

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="loading-content">
          <div className="spinner spinner-lg loading-spinner" />
          <div className="loading-text">加载中...</div>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!session.token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // Authenticated - show main app
  return (
    <BrowserRouter>
      <AnimatePresence mode="wait">
        <Routes>
          <Route
            path="/"
            element={
              <Layout role={session.role} onSignOut={handleSignOut} />
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route
              path="dashboard"
              element={<DashboardPage role={session.role} />}
            />
            <Route path="map" element={<MapPage />} />
            <Route
              path="profile"
              element={<ProfilePage role={session.role} />}
            />
            <Route
              path="admin/*"
              element={
                <ProtectedRoute role={session.role} requiredRole="admin">
                  <AdminPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </AnimatePresence>
    </BrowserRouter>
  );
}
