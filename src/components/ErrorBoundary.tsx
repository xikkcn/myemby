import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Alert, Button, Card, Space } from 'antd';
import { useEmbyStore } from '../stores/embyStore';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryClass extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('组件错误:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px' }}>
          <Card>
            <Alert
              message="应用程序发生错误"
              description={this.state.error?.message || '未知错误'}
              type="error"
              showIcon
            />
            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <Space>
                <Button 
                  type="primary" 
                  onClick={() => this.setState({ hasError: false, error: null })}
                >
                  重试
                </Button>
                <Button onClick={() => window.location.reload()}>
                  刷新页面
                </Button>
              </Space>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// 连接状态监测组件
const ConnectionMonitor: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { connectionError, setConnectionError } = useEmbyStore();

  if (connectionError) {
    return (
      <div style={{ padding: '20px' }}>
        <Card>
          <Alert
            message="连接错误"
            description={connectionError}
            type="error"
            showIcon
          />
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <Button 
              type="primary" 
              onClick={() => setConnectionError(null)}
            >
              确认
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};

// 组合错误边界和连接监测
const ErrorBoundary: React.FC<Props> = ({ children }) => {
  return (
    <ErrorBoundaryClass>
      <ConnectionMonitor>
        {children}
      </ConnectionMonitor>
    </ErrorBoundaryClass>
  );
};

export default ErrorBoundary; 