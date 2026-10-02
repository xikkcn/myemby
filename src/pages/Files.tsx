import React, { useEffect, useRef, useState } from 'react';
import { Card, Button, Input, Modal, Space, Empty, Spin, Alert, message, Popconfirm, Breadcrumb } from 'antd';
import {
  PlusOutlined,
  FolderOutlined,
  FileOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  ArrowLeftOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { useFileStore, DavEntry, isVideoFile, isAudioFile } from '../stores/fileSourceStore';
import './Files.scss';

function prettySize(bytes?: number): string {
  if (!bytes || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 直接播放层：WebDAV 的文件可以直接交给 <video>，浏览器会按需 Range 请求 */
const FilePlayer: React.FC<{ entry: DavEntry | null; onClose: () => void }> = ({ entry, onClose }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const isAudio = entry ? isAudioFile(entry.name) : false;

  useEffect(() => {
    const v = ref.current;
    if (!v || !entry) return;
    v.load();
    v.play().catch(() => undefined);
  }, [entry]);

  if (!entry) return null;

  return (
    <div className="file-player-overlay">
      <div className="file-player-head">
        <span className="file-player-title">{entry.name}</span>
        <Button type="text" icon={<CloseOutlined />} onClick={onClose} className="close-btn" />
      </div>
      <div className="file-player-body">
        {isAudio ? (
          <div className="audio-wrap">
            <div className="audio-name">{entry.name}</div>
            <audio ref={ref as any} src={entry.url} controls autoPlay style={{ width: '80%' }} />
          </div>
        ) : (
          <video ref={ref} src={entry.url} controls playsInline autoPlay className="file-video" />
        )}
      </div>
    </div>
  );
};

const Files: React.FC = () => {
  const {
    sources,
    activeSourceId,
    currentPath,
    entries,
    loading,
    error,
    addSource,
    removeSource,
    setActiveSource,
    browse,
    setError,
  } = useFileStore();

  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [user, setUser] = useState('');
  const [pwd, setPwd] = useState('');
  const [playing, setPlaying] = useState<DavEntry | null>(null);

  const active = sources.find((s) => s.id === activeSourceId) || null;

  useEffect(() => {
    if (error) message.error(error);
  }, [error]);

  useEffect(() => {
    // 进来时若已有源但没加载内容，自动拉一次
    if (active && !entries.length && !loading) browse(currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSourceId]);

  const handleAdd = async () => {
    const r = await addSource(url, name, user, pwd);
    if (r.ok) {
      message.success('连接成功');
      setAddOpen(false);
      setUrl('');
      setName('');
      setUser('');
      setPwd('');
    }
  };

  /** 面包屑：按当前路径拆段 */
  const crumbs = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <div className="files-container">
      <div className="files-toolbar">
        {active ? (
          <>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => {
                const up = crumbs.slice(0, -1).join('/');
                browse(up);
              }}
              disabled={!crumbs.length}
            >
              上一级
            </Button>
            <span className="files-source-name">{active.name}</span>
          </>
        ) : (
          <span className="files-source-name">文件源</span>
        )}
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          添加文件源
        </Button>
      </div>

      {error && (
        <Alert type="warning" showIcon closable message={error} onClose={() => setError(null)} className="files-alert" />
      )}

      {/* 源列表（未选中源时展示） */}
      {!active ? (
        sources.length ? (
          <Card className="files-card" title="选择文件源">
            {sources.map((s) => (
              <div className="source-row" key={s.id}>
                <div className="source-info" onClick={() => setActiveSource(s.id)}>
                  <div className="source-name">{s.name}</div>
                  <div className="source-desc">{s.url}</div>
                </div>
                <Popconfirm title="移除该文件源？" onConfirm={() => removeSource(s.id)}>
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                </Popconfirm>
              </div>
            ))}
          </Card>
        ) : (
          <Card className="files-card">
            <Empty description="还没有文件源" />
            <div className="files-tip">
              支持 WebDAV 协议：Alist、Nextcloud、群晖、飞牛 fnOS 等开启 WebDAV 后填地址即可
            </div>
          </Card>
        )
      ) : (
        <>
          {/* 路径 */}
          {crumbs.length > 0 && (
            <Breadcrumb className="files-crumb">
              <Breadcrumb.Item>
                <a onClick={() => browse('')}>根目录</a>
              </Breadcrumb.Item>
              {crumbs.map((c, i) => (
                <Breadcrumb.Item key={i}>
                  <a onClick={() => browse(crumbs.slice(0, i + 1).join('/'))}>{c}</a>
                </Breadcrumb.Item>
              ))}
            </Breadcrumb>
          )}

          <Spin spinning={loading}>
            {entries.length ? (
              <div className="files-list">
                {entries.map((e) => (
                  <div
                    className={`file-row${e.playable ? ' playable' : ''}`}
                    key={e.path}
                    onClick={() => {
                      if (e.isDir) browse(e.path);
                      else if (e.playable) setPlaying(e);
                    }}
                  >
                    <span className="file-icon">
                      {e.isDir ? <FolderOutlined /> : e.playable ? <PlayCircleOutlined /> : <FileOutlined />}
                    </span>
                    <span className="file-main">
                      <span className="file-name">{e.name}</span>
                      <span className="file-sub">
                        {e.isDir ? '文件夹' : prettySize(e.size)}
                        {e.modified ? ` · ${new Date(e.modified).toLocaleDateString()}` : ''}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              !loading && (
                <Card className="files-card">
                  <Empty description="这个目录是空的" />
                </Card>
              )
            )}
          </Spin>
        </>
      )}

      {/* 添加源 */}
      <Modal
        title="添加文件源（WebDAV）"
        open={addOpen}
        onOk={handleAdd}
        onCancel={() => setAddOpen(false)}
        okText="连接"
        cancelText="取消"
        confirmLoading={loading}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="WebDAV 地址，例如 https://dav.example.com/dav"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input placeholder="备注名（可留空）" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="用户名（可留空）" value={user} onChange={(e) => setUser(e.target.value)} />
          <Input.Password placeholder="密码（可留空）" value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </Space>
      </Modal>

      <FilePlayer entry={playing} onClose={() => setPlaying(null)} />
    </div>
  );
};

export default Files;
