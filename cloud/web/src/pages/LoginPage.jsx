import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { loginAdmin } from '../api/client';

// Animated route background component
function RouteAnimation() {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const routesRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width = canvas.width = canvas.offsetWidth;
    let height = canvas.height = canvas.offsetHeight;

    // Generate random routes
    const generateRoute = () => {
      const points = [];
      const numPoints = 20 + Math.floor(Math.random() * 30);
      let x = Math.random() * width;
      let y = Math.random() * height;

      for (let i = 0; i < numPoints; i++) {
        points.push({ x, y });
        x += (Math.random() - 0.5) * 100;
        y += (Math.random() - 0.5) * 100;
        x = Math.max(0, Math.min(width, x));
        y = Math.max(0, Math.min(height, y));
      }

      return {
        points,
        progress: 0,
        speed: 0.002 + Math.random() * 0.003,
        color: `hsla(${180 + Math.random() * 60}, 70%, 60%, 0.6)`,
        lineWidth: 2 + Math.random() * 2,
      };
    };

    // Initialize routes
    for (let i = 0; i < 8; i++) {
      routesRef.current.push(generateRoute());
    }

    const animate = () => {
      ctx.fillStyle = 'rgba(74, 144, 226, 0.03)';
      ctx.fillRect(0, 0, width, height);

      routesRef.current.forEach((route) => {
        route.progress += route.speed;
        if (route.progress >= 1) {
          route.progress = 0;
          Object.assign(route, generateRoute());
          route.progress = 0;
        }

        const currentIndex = Math.floor(route.progress * (route.points.length - 1));
        if (currentIndex < route.points.length - 1) {
          ctx.beginPath();
          ctx.strokeStyle = route.color;
          ctx.lineWidth = route.lineWidth;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          for (let i = 0; i <= currentIndex; i++) {
            const point = route.points[i];
            if (i === 0) {
              ctx.moveTo(point.x, point.y);
            } else {
              ctx.lineTo(point.x, point.y);
            }
          }

          // Draw partial line to current position
          const t = (route.progress * (route.points.length - 1)) % 1;
          const nextPoint = route.points[currentIndex + 1];
          if (nextPoint) {
            const currentPoint = route.points[currentIndex];
            const x = currentPoint.x + (nextPoint.x - currentPoint.x) * t;
            const y = currentPoint.y + (nextPoint.y - currentPoint.y) * t;
            ctx.lineTo(x, y);

            // Draw moving dot
            ctx.stroke();
            ctx.beginPath();
            ctx.fillStyle = route.color.replace('0.6', '1');
            ctx.arc(x, y, route.lineWidth * 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.stroke();
          }
        }
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
      routesRef.current = [];
      for (let i = 0; i < 8; i++) {
        routesRef.current.push(generateRoute());
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="route-animation-canvas" />
  );
}

export default function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleInputChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError('');
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
      const session = {
        token: typeof result.token === 'string' ? result.token : '',
        role: typeof result.role === 'string' && result.role ? result.role : 'admin',
      };

      if (!session.token) {
        throw new Error('无效的登录响应');
      }

      onLogin(session);
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || '登录失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-animation-side">
        <RouteAnimation />
        <div className="animation-overlay">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <h2 className="animation-title">探索运动轨迹</h2>
            <p className="animation-description">
              用数据记录每一次运动，让轨迹见证你的成长。RouteLab 帮助你追踪、分析和优化你的运动表现。
            </p>
          </motion.div>
        </div>
      </div>

      <div className="login-form-side">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="login-header">
            <div className="login-logo">
              <Activity size={36} className="login-logo-icon" />
              <span className="login-logo-text">RouteLab</span>
            </div>
            <h1 className="login-title">欢迎回来</h1>
            <p className="login-subtitle">请使用管理员账号登录系统</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="login-input-group">
              <label htmlFor="username" className="login-label">
                用户名
              </label>
              <input
                id="username"
                type="text"
                className="login-input"
                value={form.username}
                onChange={handleInputChange('username')}
                placeholder="请输入用户名"
                autoComplete="username"
                disabled={loading}
              />
            </div>

            <div className="login-input-group">
              <label htmlFor="password" className="login-label">
                密码
              </label>
              <input
                id="password"
                type="password"
                className="login-input"
                value={form.password}
                onChange={handleInputChange('password')}
                placeholder="请输入密码"
                autoComplete="current-password"
                disabled={loading}
              />
            </div>

            {error && (
              <motion.div
                className="login-error"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {error}
              </motion.div>
            )}

            <motion.button
              type="submit"
              className="login-btn"
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.02 }}
              whileTap={{ scale: loading ? 1 : 0.98 }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="spinner spinner-sm" />
                  登录中...
                </span>
              ) : (
                '登 录'
              )}
            </motion.button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
