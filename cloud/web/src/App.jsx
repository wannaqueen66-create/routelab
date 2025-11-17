import { useState } from 'react';
import Dashboard from './pages/Dashboard';
import { getSession, setSession as persistSession, loginAdmin } from './api/client';

function Header({ onSignOut }) {
  return (
    <header className="header">
      <h1>RouteLab 数据看板</h1>
      <button type="button" onClick={onSignOut}>
        退出登录
      </button>
    </header>
  );
}

export default function App() {
  const [session, setSessionState] = useState(getSession());
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleInputChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const username = form.username.trim();
    const password = form.password;
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }

    try {
      setLoading(true);
      const result = await loginAdmin({ username, password });
      const nextSession = {
        token: typeof result.token === 'string' ? result.token : '',
        role:
          typeof result.role === 'string' && result.role ? result.role : 'admin',
      };
      if (!nextSession.token) {
        throw new Error('无效的登录响应');
      }
      persistSession(nextSession);
      setSessionState(nextSession);
      setForm({ username: '', password: '' });
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || '登录失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    const nextSession = { token: '', role: 'user' };
    persistSession(nextSession);
    setSessionState(nextSession);
    setForm({ username: '', password: '' });
    setError('');
  };

  if (!session.token) {
    return (
      <div className="auth-panel">
        <h2>管理员登录</h2>
        <p>使用分配的管理员账号访问后台数据。</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="username-input">用户名</label>
          <input
            id="username-input"
            type="text"
            value={form.username}
            autoComplete="username"
            onChange={handleInputChange('username')}
            disabled={loading}
          />
          <label htmlFor="password-input">密码</label>
          <input
            id="password-input"
            type="password"
            value={form.password}
            autoComplete="current-password"
            onChange={handleInputChange('password')}
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
        {error && <div className="error-banner">{error}</div>}
      </div>
    );
  }

  return (
    <div className="app">
      <Header onSignOut={handleSignOut} />
      <Dashboard role={session.role} />
    </div>
  );
}
