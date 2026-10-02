import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  Button,
  Input,
  Modal,
  Space,
  Empty,
  Tag,
  message,
  Popconfirm,
  Spin,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  StarOutlined,
  StarFilled,
  PlayCircleOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import Hls from 'hls.js';
import { useIptvStore, Channel } from '../stores/iptvStore';
import './Live.scss';

const { TextArea } = Input;

/** 简易 HLS 播放层：直播流只需要 hls.js，不必上 video.js */
const PlayerOverlay: React.FC<{ channel: Channel | null; onClose: () => void }> = ({ channel, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !channel) return;
    setLoading(true);
    setErr('');

    let hls: Hls | null = null;
    const url = channel.url;

    const onCanPlay = () => setLoading(false);
    v.addEventListener('canplay', onCanPlay);

    if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, enableWorker: true });
      hls.loadSource(url);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setErr('播放失败，可能是该频道暂时不可用');
          setLoading(false);
        }
      });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url;
    } else {
      setErr('当前环境不支持 HLS 播放');
      setLoading(false);
    }

    v.play().catch(() => {
      /* 自动播放被拦，等用户点一下 */
    });

    return () => {
      v.removeEventListener('canplay', onCanPlay);
      if (hls) hls.destroy();
    };
  }, [channel]);

  if (!channel) return null;

  return (
    <div className="live-player-overlay">
      <div className="live-player-head">
        <span className="live-player-title">{channel.name}</span>
        <Button type="text" icon={<CloseOutlined />} onClick={onClose} className="close-btn" />
      </div>
      <div className="live-player-body">
        {loading && !err && <Spin className="live-spin" tip="正在连接…" />}
        {err && <Alert type="error" message={err} showIcon className="live-err" />}
        <video ref={videoRef} controls playsInline className="live-video" />
      </div>
    </div>
  );
};

const Live: React.FC = () => {
  const {
    sources,
    channels,
    activeGroup,
    favorites,
    loading,
    error,
    addSource,
    refreshSource,
    removeSource,
    setActiveGroup,
    toggleFavorite,
    clearAll,
  } = useIptvStore();

  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [playing, setPlaying] = useState<Channel | null>(null);
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    if (error) message.error(error);
  }, [error]);

  /** 分组列表（收藏单独作为一组放在最前） */
  const groups = useMemo(() => {
    const set = new Set<string>();
    channels.forEach((c) => set.add(c.group || '未分组'));
    const arr = [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    return ['收藏', ...arr];
  }, [channels]);

  /** 当前要展示的频道 */
  const visible = useMemo(() => {
    let list = channels;
    if (activeGroup === '收藏') {
      list = channels.filter((c) => favorites.includes(c.id));
    } else if (activeGroup) {
      list = channels.filter((c) => (c.group || '未分组') === activeGroup);
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) list = list.filter((c) => c.name.toLowerCase().includes(kw));
    return list;
  }, [channels, activeGroup, favorites, keyword]);

  const handleAdd = async () => {
    const r = await addSource(url, name);
    if (r.ok) {
      message.success(`已导入 ${r.count} 个频道`);
      setAddOpen(false);
      setUrl('');
      setName('');
    }
  };

  return (
    <div className="live-container">
      <div className="live-toolbar">
        <Input
          placeholder="搜索频道"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          allowClear
          className="live-search"
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          添加源
        </Button>
      </div>

      {/* 分组切换：横向滚动 */}
      {groups.length > 1 && (
        <div className="live-groups">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              className={`live-group${(activeGroup || '') === g || (!activeGroup && g === groups[1]) ? ' active' : ''}`}
              onClick={() => setActiveGroup(g === groups[1] ? '' : g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {/* 频道列表 */}
      {!channels.length ? (
        <Card className="live-empty-card">
          <Empty description="还没有频道，点右上角「添加源」导入 M3U / TXT 频道表" />
          <div className="live-empty-tip">
            支持 M3U、M3U8 播放列表，也支持 <code>频道名,播放地址</code> 形式的 TXT 列表
          </div>
        </Card>
      ) : (
        <>
          <div className="live-count">
            共 {visible.length} 个频道
            {sources.length > 0 && (
              <Popconfirm title="清空全部频道与源？" onConfirm={clearAll}>
                <Button type="link" size="small" danger>
                  清空
                </Button>
              </Popconfirm>
            )}
          </div>
          <div className="channel-grid">
            {visible.map((c) => (
              <div className="channel-card" key={c.id} onClick={() => setPlaying(c)}>
                <div className="channel-logo">
                  {c.logo ? (
                    <img
                      src={c.logo}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : null}
                  <PlayCircleOutlined className="channel-play" />
                </div>
                <div className="channel-name">{c.name}</div>
                <button
                  type="button"
                  className={`channel-fav${favorites.includes(c.id) ? ' on' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(c.id);
                  }}
                >
                  {favorites.includes(c.id) ? <StarFilled /> : <StarOutlined />}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 已导入的源 */}
      {sources.length > 0 && (
        <Card className="live-sources" title="已导入的源" size="small">
          {sources.map((s) => (
            <div className="source-row" key={s.id}>
              <div className="source-info">
                <div className="source-name">{s.name}</div>
                <div className="source-desc">
                  {s.lastResult || '尚未更新'} · {s.channelCount} 个频道
                </div>
              </div>
              <Space>
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={async () => {
                    const r = await refreshSource(s.id);
                    if (r.ok) message.success(`已更新，共 ${r.count} 个频道`);
                  }}
                />
                <Popconfirm title="移除该源？" onConfirm={() => removeSource(s.id)}>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            </div>
          ))}
        </Card>
      )}

      {/* 添加源 */}
      <Modal
        title="添加直播源"
        open={addOpen}
        onOk={handleAdd}
        onCancel={() => setAddOpen(false)}
        okText="导入"
        cancelText="取消"
        confirmLoading={loading}
        width={620}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="频道表地址，例如 https://example.com/live.m3u"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input placeholder="备注名（可留空）" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="add-hint">也可以直接把 M3U / TXT 内容粘贴到上面的地址框里</div>
        </Space>
      </Modal>

      {/* 播放层 */}
      <PlayerOverlay channel={playing} onClose={() => setPlaying(null)} />
    </div>
  );
};

export default Live;
