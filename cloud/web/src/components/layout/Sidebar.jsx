import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Map,
  User,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Shield,
  Activity,
} from 'lucide-react';

const navItems = [
  { path: '/dashboard', icon: LayoutDashboard, label: '数据看板', adminOnly: false },
  { path: '/map', icon: Map, label: '轨迹地图', adminOnly: false },
  { path: '/profile', icon: User, label: '个人中心', adminOnly: false },
  { path: '/admin', icon: Shield, label: '管理后台', adminOnly: true },
];

export default function Sidebar({ collapsed, onCollapse, role, onSignOut }) {
  const location = useLocation();
  const isAdmin = role === 'admin';

  const sidebarVariants = {
    expanded: { width: 260 },
    collapsed: { width: 72 },
  };

  const itemVariants = {
    expanded: { opacity: 1, x: 0 },
    collapsed: { opacity: 0, x: -10 },
  };

  return (
    <motion.aside
      className="sidebar"
      initial={false}
      animate={collapsed ? 'collapsed' : 'expanded'}
      variants={sidebarVariants}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <Activity size={28} className="logo-icon" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                className="logo-text"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2 }}
              >
                RouteLab
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <button
          className="sidebar-toggle"
          onClick={() => onCollapse(!collapsed)}
          title={collapsed ? '展开菜单' : '收起菜单'}
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          if (item.adminOnly && !isAdmin) return null;
          const Icon = item.icon;
          const isActive = location.pathname.startsWith(item.path);

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`sidebar-item ${isActive ? 'active' : ''}`}
              title={collapsed ? item.label : ''}
            >
              <Icon size={22} className="sidebar-icon" />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    className="sidebar-label"
                    variants={itemVariants}
                    initial="collapsed"
                    animate="expanded"
                    exit="collapsed"
                    transition={{ duration: 0.2 }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {isActive && (
                <motion.div
                  className="sidebar-indicator"
                  layoutId="activeIndicator"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          className="sidebar-item logout-btn"
          onClick={onSignOut}
          title={collapsed ? '退出登录' : ''}
        >
          <LogOut size={22} className="sidebar-icon" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                className="sidebar-label"
                variants={itemVariants}
                initial="collapsed"
                animate="expanded"
                exit="collapsed"
                transition={{ duration: 0.2 }}
              >
                退出登录
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}
