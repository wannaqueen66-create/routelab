import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  User,
  Award,
  Activity,
  MessageSquare,
  Lock,
  Trophy,
  Zap,
  Map,
} from 'lucide-react';
import { fetchDailyMetrics } from '../api/client';
import { formatDistance } from '../utils/format';

// Achievement data
const ACHIEVEMENTS = [
  {
    id: 'first_route',
    name: '初次启程',
    icon: '🏃',
    description: '完成第一次运动记录',
    unlocked: true,
    progress: 100,
  },
  {
    id: 'ten_routes',
    name: '坚持不懈',
    icon: '🔥',
    description: '累计完成10次运动',
    unlocked: true,
    progress: 100,
  },
  {
    id: 'fifty_km',
    name: '里程碑',
    icon: '🎯',
    description: '累计运动距离达到50公里',
    unlocked: true,
    progress: 100,
  },
  {
    id: 'hundred_km',
    name: '百里征程',
    icon: '🏅',
    description: '累计运动距离达到100公里',
    unlocked: false,
    progress: 65,
  },
  {
    id: 'early_bird',
    name: '早起鸟儿',
    icon: '🌅',
    description: '在早上6点前开始运动',
    unlocked: false,
    progress: 0,
  },
  {
    id: 'night_owl',
    name: '夜跑达人',
    icon: '🌙',
    description: '在晚上9点后完成运动',
    unlocked: true,
    progress: 100,
  },
  {
    id: 'speed_demon',
    name: '风驰电掣',
    icon: '⚡',
    description: '平均配速低于5分钟/公里',
    unlocked: false,
    progress: 30,
  },
  {
    id: 'marathon',
    name: '马拉松',
    icon: '🏆',
    description: '单次运动距离超过42公里',
    unlocked: false,
    progress: 0,
  },
  {
    id: 'weekly_streak',
    name: '周周坚持',
    icon: '📅',
    description: '连续7天都有运动记录',
    unlocked: false,
    progress: 43,
  },
  {
    id: 'calorie_burner',
    name: '燃脂达人',
    icon: '🔥',
    description: '单次运动消耗超过500卡路里',
    unlocked: false,
    progress: 80,
  },
  {
    id: 'social_star',
    name: '社交之星',
    icon: '⭐',
    description: '获得10个点赞',
    unlocked: false,
    progress: 20,
  },
  {
    id: 'explorer',
    name: '探索者',
    icon: '🗺️',
    description: '在5个不同地点运动',
    unlocked: true,
    progress: 100,
  },
];

// Achievement Card Component with 3D flip effect
function AchievementCard({ achievement }) {
  return (
    <motion.div
      className={`profile-achievement-card ${achievement.unlocked ? '' : 'locked'}`}
      whileHover={{ scale: 1.05, rotateY: 10 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <div className="profile-achievement-icon">{achievement.icon}</div>
      <div className="profile-achievement-name">{achievement.name}</div>
      <div className="profile-achievement-desc">{achievement.description}</div>
      {!achievement.unlocked && achievement.progress > 0 && (
        <div className="profile-achievement-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${achievement.progress}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 mt-1">
            {achievement.progress}%
          </span>
        </div>
      )}
      {achievement.unlocked && (
        <div className="badge badge-success mt-2">已解锁</div>
      )}
    </motion.div>
  );
}

// Password Change Form
function PasswordChangeForm() {
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      setMessage({ type: 'error', text: '两次输入的密码不一致' });
      return;
    }
    if (form.newPassword.length < 6) {
      setMessage({ type: 'error', text: '新密码长度至少为6位' });
      return;
    }

    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setMessage({ type: 'success', text: '密码修改成功' });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setLoading(false);
    }, 1000);
  };

  return (
    <form onSubmit={handleSubmit} className="password-form">
      <div className="input-group">
        <label className="input-label">当前密码</label>
        <input
          type="password"
          className="input"
          value={form.currentPassword}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
          required
        />
      </div>
      <div className="input-group">
        <label className="input-label">新密码</label>
        <input
          type="password"
          className="input"
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          required
        />
      </div>
      <div className="input-group">
        <label className="input-label">确认新密码</label>
        <input
          type="password"
          className="input"
          value={form.confirmPassword}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          required
        />
      </div>
      {message.text && (
        <div className={`alert alert-${message.type}`}>{message.text}</div>
      )}
      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? '修改中...' : '修改密码'}
      </button>
    </form>
  );
}

export default function ProfilePage({ role }) {
  const [activeTab, setActiveTab] = useState('records');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = role === 'admin';

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await fetchDailyMetrics({ days: 30 });
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const totalDistance = stats?.total_distance_meters || 45000;
  const totalDuration = stats?.total_duration_seconds || 18000;
  const totalRoutes = stats?.total_routes || 23;

  const tabs = [
    { id: 'records', label: '运动记录', icon: Activity },
    { id: 'achievements', label: '成就墙', icon: Award },
    { id: 'social', label: '社交动态', icon: MessageSquare },
    { id: 'password', label: '修改密码', icon: Lock },
  ];

  return (
    <div className="profile-page">
      {/* Profile Banner */}
      <motion.div
        className="profile-banner"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="profile-banner-content">
          <div className="profile-avatar">
            <User size={48} />
          </div>
          <div className="profile-info">
            <h1 className="profile-name">
              {isAdmin ? '系统管理员' : '运动达人'}
            </h1>
            <p className="profile-bio">
              热爱运动，追求健康生活。已累计运动 {formatDistance(totalDistance)}
            </p>
            <div className="profile-badges">
              <span className="badge badge-success">Lv.{Math.floor(totalRoutes / 5) + 1}</span>
              {isAdmin && <span className="badge badge-admin">管理员</span>}
              <span className="badge badge-user">{totalRoutes} 次运动</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Quick Stats */}
      <motion.div
        className="profile-quick-stats"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="profile-stat-item">
          <Map size={24} />
          <div>
            <div className="profile-stat-value">{formatDistance(totalDistance)}</div>
            <div className="profile-stat-label">总里程</div>
          </div>
        </div>
        <div className="profile-stat-item">
          <Activity size={24} />
          <div>
            <div className="profile-stat-value">{totalRoutes}</div>
            <div className="profile-stat-label">运动次数</div>
          </div>
        </div>
        <div className="profile-stat-item">
          <Zap size={24} />
          <div>
            <div className="profile-stat-value">{Math.floor(totalDistance / 1000 * 60)}</div>
            <div className="profile-stat-label">消耗卡路里</div>
          </div>
        </div>
        <div className="profile-stat-item">
          <Trophy size={24} />
          <div>
            <div className="profile-stat-value">
              {ACHIEVEMENTS.filter((a) => a.unlocked).length}
            </div>
            <div className="profile-stat-label">已获成就</div>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div
        className="profile-tabs"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="profile-tab-header">
          <div className="tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`tab ${activeTab === tab.id ? 'tab-active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="profile-tab-content">
          {activeTab === 'records' && (
            <div className="profile-records-list">
              <h3 className="text-lg font-semibold mb-4">最近运动记录</h3>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: '80px', marginBottom: '12px' }} />
                ))
              ) : (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <motion.div
                      key={i}
                      className="profile-record-item"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                    >
                      <div className="profile-record-icon">
                        <Activity size={20} />
                      </div>
                      <div className="profile-record-info">
                        <div className="profile-record-title">晨跑训练</div>
                        <div className="profile-record-date">
                          {new Date(Date.now() - i * 86400000).toLocaleDateString('zh-CN')}
                        </div>
                      </div>
                      <div className="profile-record-stats">
                        <span>{(3 + Math.random() * 5).toFixed(1)} km</span>
                        <span>{Math.floor(20 + Math.random() * 30)} min</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'achievements' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold">成就墙</h3>
                <span className="text-sm text-gray-500">
                  已解锁 {ACHIEVEMENTS.filter((a) => a.unlocked).length}/{ACHIEVEMENTS.length}
                </span>
              </div>
              <div className="profile-achievements-grid">
                {ACHIEVEMENTS.map((achievement, idx) => (
                  <motion.div
                    key={achievement.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <AchievementCard achievement={achievement} />
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'social' && (
            <div className="profile-social-feed">
              <h3 className="text-lg font-semibold mb-4">社交动态</h3>
              <div className="empty-state">
                <MessageSquare size={48} className="empty-state-icon" />
                <div className="empty-state-title">暂无动态</div>
                <div className="empty-state-description">
                  与好友分享你的运动成果，互相激励吧！
                </div>
              </div>
            </div>
          )}

          {activeTab === 'password' && (
            <div>
              <h3 className="text-lg font-semibold mb-4">修改密码</h3>
              <div style={{ maxWidth: '400px' }}>
                <PasswordChangeForm />
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
