import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from './Sidebar';
import Header from './Header';

const pageTitles = {
  '/dashboard': '数据看板',
  '/map': '轨迹地图',
  '/profile': '个人中心',
  '/admin': '管理后台',
};

export default function Layout({ role, onSignOut }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();

  const getPageTitle = () => {
    for (const [path, title] of Object.entries(pageTitles)) {
      if (location.pathname.startsWith(path)) {
        return title;
      }
    }
    return '数据看板';
  };

  const pageVariants = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  };

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        role={role}
        onSignOut={onSignOut}
      />

      <div className="main-container">
        <Header
          role={role}
          onSignOut={onSignOut}
          title={getPageTitle()}
        />

        <main className="main-content">
          <motion.div
            key={location.pathname}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="page-wrapper"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
