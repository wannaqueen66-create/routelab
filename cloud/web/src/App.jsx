import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { clearSession, getSession, setSession as persistSession } from './api/client';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import DashboardPage from './pages/DashboardPage';
import MapPage from './pages/MapPage';
import ProfilePage from './pages/ProfilePage';
import AdminDashboard from './pages/AdminDashboard';

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
  const [authMessage, setAuthMessage] = useState('');

  useEffect(() => {
    // Check session on mount
    const savedSession = getSession();
    setSessionState(savedSession);
    setLoading(false);

    const handleUnauthorized = (event) => {
      const nextSession = { token: '', role: 'user' };
      setSessionState(nextSession);
      const nextMessage = event?.detail?.message || '登录状态已失效，请重新登录';
      setAuthMessage(nextMessage);
    };

    window.addEventListener('routelab:auth-cleared', handleUnauthorized);
    return () => {
      window.removeEventListener('routelab:auth-cleared', handleUnauthorized);
    };
  }, []);

  const handleLogin = (newSession) => {
    persistSession(newSession);
    setSessionState(newSession);
    setAuthMessage('');
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
    return <LoginPage onLogin={handleLogin} initialError={authMessage} />;
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
              element={session.role === 'admin' ? <DashboardPage /> : <Dashboard />}
            />
            <Route
              path="map"
              element={
                <ProtectedRoute role={session.role} requiredRole="admin">
                  <MapPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="profile"
              element={
                session.role === 'admin' ? <Navigate to="/admin" replace /> : <ProfilePage role={session.role} />
              }
            />
            <Route
              path="admin/*"
              element={
                <ProtectedRoute role={session.role} requiredRole="admin">
                  <AdminDashboard />
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
