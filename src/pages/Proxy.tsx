import React, { useEffect, useState } from 'react';
import {
  Card,
  Switch,
  Button,
  List,
  Tag,
  Space,
  Input,
  Modal,
  message,
  Alert,
  Empty,
  Tooltip,
  Segmented,
  Popconfirm,
  Progress,
} from 'antd';
import {
  ThunderboltOutlined,
  DeleteOutlined,
  ReloadOutlined,
  PlusOutlined,
  CloudDownloadOutlined,
  LinkOutlined,
  DashboardOutlined,
  MobileOutlined,
} from '@ant-design/icons';
import { useProxyStore } from '../stores/proxyStore';
import { requiresSingbox } from '../proxy/parse';
import { proxyBackend } from '../platform/proxy';
import { isTVMode } from '../platform';
import TvConfigModal from '../components/TvConfigModal';
import Promo from '../components/Promo';
import './Proxy.scss';

const { TextArea } = Input;

const PROTOCOL_LABEL: Record<string, string> = {
  vmess: 'VMess',
  vless: 'VLESS',
  trojan: 'Trojan',
  shadowsocks: 'SS',
  socks: 'SOCKS5',
  http: 'HTTP',
  hysteria2: 'Hysteria2',
  tuic: 'TUIC',
};

function delayColor(d?: number): string {
  if (d === undefined) return '';
  if (d < 0) return 'red';
  if (d < 200) return 'green';
  if (d < 500) return 'orange';
  return 'volcano';
}

const Proxy: React.FC = () => {
  const {
    nodes,
    subscriptions,
    selectedNodeId,
    enabled,
    preferredCore,
    localPort,
    status,
    latency,
    logs,
    busy,
    error,
    cores,
    init,
    selectNode,
    toggle,
    testLatency,
    addSubscription,
    refreshSubscription,
    removeSubscription,
    addNodesFromText,
    removeNode,
    clearNodes,
    setPreferredCore,
    setLocalPort,
    clearLogs,
    clearError,
  } = useProxyStore();

  const [subModal, setSubModal] = useState(false);
  const [manualModal, setManualModal] = useState(false);
  const [tvModal, setTvModal] = useState(false);
  const [subUrl, setSubUrl] = useState('');
  const [subName, setSubName] = useState('');
  const [manualText, setManualText] = useState('');
  const [portInput, setPortInput] = useState(String(localPort));

  const backend = proxyBackend();
  const tv = isTVMode();

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    setPortInput(String(localPort));
  }, [localPort]);

  const selected = nodes.find((n) => n.id === selectedNodeId) || null;

  const handleToggle = async () => {
    const r = await toggle();
    if (r.ok) {
      message.success(enabled ? '已关闭网络加速' : '网络加速已开启');
    } else if (r.error) {
      message.error(r.error);
    }
  };

  const handleAddSub = async () => {
    const r = await addSubscription(subUrl, subName);
    if (r.ok) {
      message.success(`订阅导入成功，共 ${r.count} 个节点`);
      setSubModal(false);
      setSubUrl('');
      setSubName('');
    } else {
      message.error(r.error || '导入失败');
    }
  };

  const handleAddManual = () => {
    const r = addNodesFromText(manualText);
    if (r.count > 0) {
      message.success(`已添加 ${r.count} 个节点`);
      setManualModal(false);
      setManualText('');
    } else {
      message.warning('没有识别到可用节点，请检查链接格式');
    }
  };

  const coreHint = (() => {
    if (!selected) return null;
    if (requiresSingbox(selected) && !cores.singbox?.available) {
      return `该节点是 ${PROTOCOL_LABEL[selected.protocol]} 协议，需要 sing-box 核心，但当前设备上没有找到。`;
    }
    if (preferredCore === 'xray' && requiresSingbox(selected)) {
      return `已选择「仅用 Xray」，但 Xray 不支持 ${PROTOCOL_LABEL[selected.protocol]}，启动时会自动改用 sing-box。`;
    }
    return null;
  })();

  return (
    <div className={`proxy-container${tv ? ' tv' : ''}`}>
      {!backend.supported && (
        <Alert
          type="info"
          showIcon
          message="网页版不支持内置加速"
          description="浏览器里无法启动本地代理核心。请使用桌面端（Windows / Linux）或电视端 / 安卓端。"
          className="proxy-alert"
        />
      )}

      {/* ---------------------------------------- 总开关 */}
      <Card className="proxy-card overview-card">
        <div className="overview-row">
          <div className="overview-left">
            <div className="overview-title">
              <ThunderboltOutlined /> 网络加速
            </div>
            <div className="overview-desc">
              内置 Xray / sing-box 核心，只加速 myemby 自身的流量，不影响系统里其他软件
            </div>
          </div>
          <div className="overview-right">
            <Switch
              checked={enabled}
              loading={busy}
              onChange={handleToggle}
              disabled={!backend.supported || !nodes.length}
              checkedChildren="已开启"
              unCheckedChildren="已关闭"
            />
          </div>
        </div>

        <div className="status-grid">
          <div className="status-item">
            <span className="label">当前节点</span>
            <span className="value">{selected ? selected.name : '未选择'}</span>
          </div>
          <div className="status-item">
            <span className="label">核心</span>
            <span className="value">
              {status?.core === 'singbox' ? 'sing-box' : status?.core === 'xray' ? 'Xray' : '—'}
            </span>
          </div>
          <div className="status-item">
            <span className="label">本地端口</span>
            <span className="value">{localPort}</span>
          </div>
          <div className="status-item">
            <span className="label">运行时长</span>
            <span className="value">{status?.running ? `${status.uptime}s` : '—'}</span>
          </div>
        </div>

        <div className="core-row">
          <span className="label">核心选择</span>
          <Segmented
            value={preferredCore}
            onChange={(v) => setPreferredCore(v as any)}
            options={[
              { label: '自动', value: 'auto' },
              { label: '仅 Xray', value: 'xray' },
              { label: '仅 sing-box', value: 'singbox' },
            ]}
          />
          <Space className="port-edit">
            <span className="label">端口</span>
            <Input
              size="small"
              style={{ width: 88 }}
              value={portInput}
              onChange={(e) => setPortInput(e.target.value.replace(/\D/g, ''))}
              onBlur={() => setLocalPort(parseInt(portInput, 10) || 20808)}
            />
          </Space>
        </div>

        <div className="core-avail">
          {['xray', 'singbox'].map((c) => (
            <Tag key={c} color={cores[c]?.available ? 'green' : 'default'}>
              {c === 'xray' ? 'Xray' : 'sing-box'} {cores[c]?.available ? '就绪' : '未就绪'}
            </Tag>
          ))}
          {tv && (
            <Button size="small" icon={<MobileOutlined />} onClick={() => setTvModal(true)}>
              用手机扫码配置
            </Button>
          )}
        </div>
      </Card>

      {(error || coreHint || status?.lastError) && (
        <Alert
          type={error ? 'error' : 'warning'}
          showIcon
          closable
          onClose={clearError}
          message={error || status?.lastError || coreHint}
          className="proxy-alert"
        />
      )}

      {/* ---------------------------------------- 节点 */}
      <Card
        className="proxy-card"
        title={`节点（${nodes.length}）`}
        extra={
          <Space>
            <Button
              size="small"
              icon={<DashboardOutlined />}
              onClick={() => testLatency()}
              disabled={!nodes.length || busy}
            >
              全部测速
            </Button>
            {nodes.length > 0 && (
              <Popconfirm title="清空全部节点？" onConfirm={clearNodes}>
                <Button size="small" danger>
                  清空
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        {!nodes.length ? (
          <Empty description="还没有节点，先在下面添加订阅或粘贴节点链接" />
        ) : (
          <List
            className="node-list"
            dataSource={nodes}
            renderItem={(n) => {
              const lat = latency[n.id];
              const active = n.id === selectedNodeId;
              return (
                <List.Item
                  className={`node-item${active ? ' active' : ''}`}
                  onClick={() => selectNode(n.id)}
                  actions={[
                    <span className={`delay ${delayColor(lat?.delay)}`} key="d">
                      {lat === undefined ? '—' : lat.delay < 0 ? lat.error || '失败' : `${lat.delay} ms`}
                    </span>,
                    <Button
                      type="text"
                      size="small"
                      key="p"
                      icon={<ThunderboltOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        testLatency([n.id]);
                      }}
                    />,
                    <Popconfirm
                      key="del"
                      title="删除该节点？"
                      onConfirm={() => removeNode(n.id)}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <span className="node-name">{n.name}</span>
                        <Tag color="blue">{PROTOCOL_LABEL[n.protocol] || n.protocol}</Tag>
                        {requiresSingbox(n) && <Tag color="purple">需 sing-box</Tag>}
                        {active && <Tag color="green">使用中</Tag>}
                      </Space>
                    }
                    description={`${n.server}:${n.port}`}
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Card>

      {/* ---------------------------------------- 添加 */}
      <Card className="proxy-card" title="添加节点">
        <Space wrap>
          <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setSubModal(true)}>
            从订阅导入
          </Button>
          <Button icon={<LinkOutlined />} onClick={() => setManualModal(true)}>
            粘贴节点链接
          </Button>
          <Tooltip title="订阅会自动记录，方便以后一键更新">
            <span className="hint">支持 vmess / vless / trojan / ss / hysteria2 / tuic</span>
          </Tooltip>
        </Space>

        {subscriptions.length > 0 && (
          <List
            className="sub-list"
            size="small"
            header={<span className="sub-header">已添加的订阅</span>}
            dataSource={subscriptions}
            renderItem={(s) => (
              <List.Item
                actions={[
                  <Button
                    key="r"
                    type="text"
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={busy}
                    onClick={async () => {
                      const r = await refreshSubscription(s.id);
                      if (r.ok) message.success(`已更新，共 ${r.count} 个节点`);
                      else message.error(r.error || '更新失败');
                    }}
                  />,
                  <Popconfirm key="d" title="删除订阅及其节点？" onConfirm={() => removeSubscription(s.id)}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={s.name}
                  description={
                    <span className="sub-desc">
                      {s.lastResult || '尚未更新'}
                      {s.updatedAt ? ` · ${new Date(s.updatedAt).toLocaleString()}` : ''}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* ---------------------------------------- 日志 */}
      <Card
        className="proxy-card"
        title="运行日志"
        extra={
          <Space>
            <Button size="small" onClick={clearLogs}>
              清空
            </Button>
          </Space>
        }
      >
        <pre className="proxy-logs">{logs.length ? logs.join('\n') : '（暂无日志）'}</pre>
      </Card>

      <Promo variant="card" />

      {/* ---------------------------------------- 弹窗 */}
      <Modal
        title="从订阅导入"
        open={subModal}
        onOk={handleAddSub}
        onCancel={() => setSubModal(false)}
        okText="导入"
        cancelText="取消"
        confirmLoading={busy}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="订阅地址，例如 https://example.com/api/v1/client/subscribe?token=xxx"
            value={subUrl}
            onChange={(e) => setSubUrl(e.target.value)}
          />
          <Input placeholder="备注名（可留空）" value={subName} onChange={(e) => setSubName(e.target.value)} />
        </Space>
      </Modal>

      <Modal
        title="粘贴节点链接"
        open={manualModal}
        onOk={handleAddManual}
        onCancel={() => setManualModal(false)}
        okText="添加"
        cancelText="取消"
        width={620}
      >
        <TextArea
          rows={8}
          placeholder={'每行一条，支持：\nvmess://...\nvless://...\ntrojan://...\nss://...\nhysteria2://...'}
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
        />
      </Modal>

      <TvConfigModal open={tvModal} onClose={() => setTvModal(false)} />
    </div>
  );
};

export default Proxy;
