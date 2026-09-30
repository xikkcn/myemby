import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Spin, Empty, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { AppstoreOutlined } from '@ant-design/icons';
import { useMediaLibraryStore, LibraryView } from '../stores/mediaLibraryStore';
import { useEmbyStore } from '../stores/embyStore';
import './MediaLibraries.scss';

const { Title } = Typography;

const MediaLibraries: React.FC = () => {
  const navigate = useNavigate();
  const { libraries, isLoading, error, fetchLibraries, getLibraryImageUrl } = useMediaLibraryStore();
  const { isLoggedIn } = useEmbyStore();
  
  // 当用户登录状态变化时，获取媒体库列表
  useEffect(() => {
    if (isLoggedIn) {
      fetchLibraries();
    }
  }, [isLoggedIn, fetchLibraries]);

  const handleLibraryClick = (library: LibraryView) => {
    // 根据媒体库类型导航到不同页面
    switch (library.CollectionType) {
      case 'movies':
        navigate('/movies', { state: { libraryId: library.Id } });
        break;
      case 'tvshows':
        navigate('/series', { state: { libraryId: library.Id } });
        break;
      default:
        // 对于其他类型，可以先导航到通用页面或当前还不支持的提示
        message.info(`暂不支持 ${library.Name} (${library.CollectionType || '未知类型'}) 类型的媒体库浏览`);
        break;
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="media-libraries-container">
        <Empty description="请先登录以查看媒体库" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="media-libraries-container loading">
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="media-libraries-container error">
        <Empty description={error} />
      </div>
    );
  }

  if (libraries.length === 0) {
    return (
      <div className="media-libraries-container empty">
        <Empty description="没有可用的媒体库" />
      </div>
    );
  }

  return (
    <div className="media-libraries-container">
      <Title level={4} className="section-title">
        <AppstoreOutlined /> 媒体库
      </Title>
      
      <Row gutter={[16, 16]} className="libraries-grid">
        {libraries.map(library => (
          <Col xs={12} sm={8} md={6} lg={6} xl={4} key={library.Id}>
            <Card
              hoverable
              cover={
                <div className="library-card-cover">
                  <img
                    alt={library.Name}
                    src={getLibraryImageUrl(library)}
                    className="library-image"
                  />
                  <div className="library-type-badge">{library.CollectionType}</div>
                </div>
              }
              className="library-card"
              onClick={() => handleLibraryClick(library)}
            >
              <Card.Meta
                title={library.Name}
                description={`${library.CollectionType || '未知类型'}`}
              />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default MediaLibraries; 