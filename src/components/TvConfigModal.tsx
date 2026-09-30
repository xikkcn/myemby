import React, { useEffect, useState, useCallback } from 'react';
import { Modal, Button, Alert, Space, Spin, message, Tag } from 'antd';
import { ReloadOutlined, MobileOutlined } from '@ant-design/icons';
import QRCode from 'qrcode';
import { useProxyStore } from '../stores/proxyStore';
import './TvConfigModal.scss';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 电视端「用手机扫码配置」弹窗
 *
 * 电视盒子基本没有摄像头，所以扫码只能反过来做：
 * 电视上起一个仅局域网可达的配置页，把地址显示成二维码；
 * 手机扫码打开该页面，粘贴节点/订阅链接提交，电视端立刻导入。
 */
const TvConfigModal: React.FC<Props> = ({ open, onClose }) => {
  const [qr, setQr] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const addNodesFromText = useProxyStore((s) => s.addNodesFromText);
  const addSubscription = useProxyStore((s) => s.addSubscription);

  const plugin = (window as any).Capacitor?.Plugins?.MyembyProxy || null;

  const startServer = useCallback(async () => {
    if (!plugin) {
      setErr('扫码配置只在电视端 / 安卓端可用');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const r = await plugin.startConfigServer();
      if (!r?.url) throw new Error(r?.error || '配置页启动失败');
      setUrl(r.url);
      const dataUrl = await QRCode.toDataURL(r.url, {
        width: 260,
        margin: 1,
        color: { dark: '#1f2d3d', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      setQr(dataUrl);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [plugin]);

  // 监听手机端提交的内容
  useEffect(() => {
    if (!plugin || !open) return;
    const handle = plugin.addListener('proxyConfigImported', (d: any) => {
      const content = (d?.content || '').trim();
      if (!content) return;
      // 订阅地址走订阅导入，其余按节点链接处理
      if (/^https?:\/\//i.test(content) && !/^https?:\/\/[^/]+@/.test(content)) {
        addSubscription(content, '手机配置').then((r) => {
          if (r.ok) message.success(`已从手机导入订阅，共 ${r.count} 个节点`);
          else message.error(r.error || '订阅导入失败');
        });
      } else {
        const r = addNodesFromText(content);
        if (r.count > 0) message.success(`已从手机导入 ${r.count} 个节点`);
        else message.warning('手机提交的内容里没有识别到节点');
      }
      onClose();
    });
    return () => {
      try {
        handle.remove();
      } catch {
        /* 忽略 */
      }
    };
  }, [plugin, open, addNodesFromText, addSubscription, onClose]);

  useEffect(() => {
    if (open) startServer();
  }, [open, startServer]);

  return (
    <Modal
      title={
        <Space>
          <MobileOutlined /> 用手机扫码配置加速节点
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="r" icon={<ReloadOutlined />} onClick={startServer} loading={loading}>
          刷新二维码
        </Button>,
        <Button key="c" type="primary" onClick={onClose}>
          完成
        </Button>,
      ]}
      width={520}
      className="tv-config-modal"
    >
      {err ? (
        <Alert type="warning" showIcon message={err} />
      ) : loading ? (
        <div className="tv-loading">
          <Spin tip="正在启动配置页..." />
        </div>
      ) : (
        <div className="qr-wrap">
          {qr && (
            <div className="qr-box">
              <img src={qr} alt="配置二维码" width={260} height={260} />
            </div>
          )}
          <div className="qr-url">{url}</div>
          <Tag color="blue">手机和电视需要在同一个 WiFi 下</Tag>
          <ol className="qr-steps">
            <li>用手机相机或微信扫描上面的二维码</li>
            <li>在打开的页面里粘贴节点链接或订阅地址</li>
            <li>点「提交」，电视上的 myemby 会自动导入并生效</li>
          </ol>
        </div>
      )}
    </Modal>
  );
};

export default TvConfigModal;
