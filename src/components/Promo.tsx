import React from 'react';
import { Button, Typography } from 'antd';
import { CrownOutlined, LinkOutlined } from '@ant-design/icons';
import { PROMO } from '../config/promo';
import './Promo.scss';

const { Text } = Typography;

interface Props {
  /** banner: 首页顶部的醒目条；card: 设置页等处的卡片；line: 页脚一行文字 */
  variant?: 'banner' | 'card' | 'line';
}

const open = () => {
  window.open(PROMO.url, '_blank', 'noopener,noreferrer');
};

/** 推广位：全端共用，样式随 variant 变化 */
const Promo: React.FC<Props> = ({ variant = 'banner' }) => {
  if (variant === 'line') {
    return (
      <div className="promo-line">
        <CrownOutlined />
        <span className="promo-line-title">{PROMO.title}</span>
        <a href={PROMO.url} target="_blank" rel="noopener noreferrer">
          {PROMO.url}
        </a>
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className="promo-card">
        <div className="promo-card-head">
          <CrownOutlined className="promo-icon" />
          <span className="promo-card-title">{PROMO.title}</span>
        </div>
        <Text type="secondary" className="promo-card-desc">
          {PROMO.long}
        </Text>
        <Button type="primary" icon={<LinkOutlined />} onClick={open} className="promo-btn">
          去了解 / 注册
        </Button>
      </div>
    );
  }

  return (
    <div className="promo-banner">
      <CrownOutlined className="promo-icon" />
      <div className="promo-text">
        <span className="promo-title">{PROMO.title}</span>
        <span className="promo-sub">{PROMO.short}</span>
      </div>
      <Button type="primary" icon={<LinkOutlined />} onClick={open} className="promo-btn">
        去看看
      </Button>
    </div>
  );
};

export default Promo;
