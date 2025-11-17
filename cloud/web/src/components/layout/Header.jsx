import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  Search,
  User,
  ChevronDown,
  Settings,
  LogOut,
  Shield,
} from 'lucide-react';

export default function Header({ role, onSignOut, title }) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const isAdmin = role === 'admin';

  return (
    <header className="app-header">
      <div className="header-left">
        <h1 className="header-title">{title || '数据看板'}</h1>
      </div>

      <div className="header-right">
        <div className="header-search">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="搜索..."
            className="search-input"
          />
        </div>

        <button className="header-icon-btn notification-btn">
          <Bell size={20} />
          <span className="notification-badge">3</span>
        </button>

        <div className="user-menu-container">
          <button
            className="user-menu-trigger"
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            <div className="user-avatar">
              <User size={20} />
            </div>
            <div className="user-info">
              <span className="user-name">
                {isAdmin ? '管理员' : '用户'}
              </span>
              {isAdmin && (
                <span className="badge badge-admin">
                  <Shield size={10} />
                  管理员
                </span>
              )}
            </div>
            <ChevronDown
              size={16}
              className={`menu-arrow ${showUserMenu ? 'open' : ''}`}
            />
          </button>

          <AnimatePresence>
            {showUserMenu && (
              <>
                <div
                  className="menu-backdrop"
                  onClick={() => setShowUserMenu(false)}
                />
                <motion.div
                  className="user-dropdown"
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="dropdown-header">
                    <div className="dropdown-avatar">
                      <User size={24} />
                    </div>
                    <div>
                      <div className="dropdown-name">
                        {isAdmin ? '系统管理员' : '普通用户'}
                      </div>
                      <div className="dropdown-role">
                        {isAdmin ? 'Administrator' : 'User'}
                      </div>
                    </div>
                  </div>
                  <div className="dropdown-divider" />
                  <button
                    className="dropdown-item"
                    onClick={() => setShowUserMenu(false)}
                  >
                    <Settings size={16} />
                    <span>系统设置</span>
                  </button>
                  <button
                    className="dropdown-item danger"
                    onClick={() => {
                      setShowUserMenu(false);
                      onSignOut();
                    }}
                  >
                    <LogOut size={16} />
                    <span>退出登录</span>
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
