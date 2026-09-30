import React from 'react';
import { Typography } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import MediaLibraries from '../components/MediaLibraries';
import './Libraries.scss';

const { Title } = Typography;

const Libraries: React.FC = () => {
  return (
    <div className="libraries-page">
      <Title level={2} className="page-title">
        <AppstoreOutlined /> 媒体库浏览
      </Title>
      <p className="page-description">
        在此页面您可以浏览所有可用的Emby媒体库。点击任一媒体库卡片以查看其中的内容。
      </p>
      
      <MediaLibraries />
    </div>
  );
};

export default Libraries; 