import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  HomeOutlined,
  AppstoreOutlined,
  PlayCircleOutlined,
  UserOutlined,
} from '@ant-design/icons';
import './MobileNav.scss';

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  /** 该路径下也判定为选中 */
  match?: string[];
}

const ITEMS: NavItem[] = [
  { key: '/', icon: <HomeOutlined />, label: '首页' },
  { key: '/libraries', icon: <AppstoreOutlined />, label: '媒体库', match: ['/movies', '/series', '/library', '/recent'] },
  { key: '/live', icon: <PlayCircleOutlined />, label: '直播' },
  { key: '/settings', icon: <UserOutlined />, label: '我的', match: ['/proxy', '/history'] },
];

/** 手机端底部导航栏 */
const MobileNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (item: NavItem) => {
    if (location.pathname === item.key) return true;
    if (item.match) return item.match.some((m) => location.pathname.startsWith(m));
    return false;
  };

  return (
    <nav className="mobile-nav">
      {ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`mobile-nav-item${isActive(item) ? ' active' : ''}`}
          onClick={() => navigate(item.key)}
        >
          <span className="nav-icon">{item.icon}</span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
};

export default MobileNav;
