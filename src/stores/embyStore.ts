import create from 'zustand';
import axios from 'axios';
import CryptoJS from 'crypto-js';
import { useServerStore } from './serverStore';
import { message } from 'antd';

// 加密密钥
const SECRET_KEY = 'emby-electron-app-secret-key';

// 加密数据
const encryptData = (data: string): string => {
  return CryptoJS.AES.encrypt(data, SECRET_KEY).toString();
};

// 解密数据
const decryptData = (ciphertext: string): string => {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('解密失败:', error);
    return '';
  }
};

interface EmbyState {
  token: string;
  userId: string;
  username: string;
  isLoggedIn: boolean;
  lastError: string | null;
  isLoading: boolean;
  serverUrl: string;
  
  login: (serverId: string, username: string, password: string) => Promise<boolean>;
  logout: () => void;
  testEmbyConnection: (serverUrl: string) => Promise<boolean>;
  getApiClient: () => any;
  handleAuthenticationError: () => void;
  setServerUrl: (url: string) => void;
}

// 创建一个默认的axios实例用于Emby API
const createApiClient = (baseURL: string, token?: string) => {
  const client = axios.create({
    baseURL,
    timeout: 30000, // 增加超时时间到30秒
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Emby-Token': token } : {})
    }
  });

  // 请求拦截器
  client.interceptors.request.use(
    (config) => {
      console.log(`API请求: ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    },
    (error) => {
      console.error('请求错误:', error);
      return Promise.reject(error);
    }
  );

  // 响应拦截器
  client.interceptors.response.use(
    (response) => {
      console.log(`API响应: ${response.status} ${response.config.url}`);
      return response;
    },
    (error) => {
      if (error.response) {
        console.error(`API错误: ${error.response.status} ${error.response.config?.url}`, error.response.data);
        
        // 如果是401错误，可能是token过期
        if (error.response.status === 401) {
          console.warn('授权失败，可能需要重新登录');
          // 这里可以触发登出操作
        }
      } else if (error.request) {
        console.error('没有收到响应:', error.message, error);
      } else {
        console.error('请求配置错误:', error.message, error);
      }
      return Promise.reject(error);
    }
  );

  return client;
};

// 初始化存储
export const useEmbyStore = create<EmbyState>((set, get) => {
  // 从本地存储加载状态
  const loadState = () => {
    try {
      const serverStore = useServerStore.getState();
      const activeServer = serverStore.getActiveServer();
      
      const savedToken = localStorage.getItem('emby_token');
      const savedUserId = localStorage.getItem('emby_userId');
      const savedUsername = localStorage.getItem('emby_username');
      
      // 如果有活跃服务器且有登录信息，则恢复登录状态
      if (activeServer && savedToken && savedUserId && savedUsername) {
        // serverUrl 必须是「协议://主机:端口」的完整地址，
        // 否则最近添加/播放历史/搜索等页面拼接出的图片地址会缺少协议和端口而无法加载
        const port = activeServer.port ? `:${activeServer.port}` : '';
        const fullServerUrl =
          localStorage.getItem('emby_serverUrl') ||
          `${activeServer.protocol}://${activeServer.url}${port}`;
        
        return {
          token: savedToken,
          userId: savedUserId,
          username: savedUsername,
          isLoggedIn: true,
          serverUrl: fullServerUrl
        };
      }
    } catch (error) {
      console.error('从本地存储加载状态失败:', error);
      // 如果加载失败，清除本地存储
      localStorage.removeItem('emby_token');
      localStorage.removeItem('emby_userId');
      localStorage.removeItem('emby_username');
    }
    
    return {
      token: '',
      userId: '',
      username: '',
      isLoggedIn: false,
      serverUrl: ''
    };
  };
  
  const initialState = loadState();
  
  return {
    ...initialState,
    lastError: null,
    isLoading: false,
    
    // 测试Emby服务器连接
    testEmbyConnection: async (serverUrl: string) => {
      try {
        set({ isLoading: true, lastError: null });
        console.log(`测试连接到Emby服务器: ${serverUrl}`);
        
        // 确保URL格式正确
        let formattedUrl = serverUrl.trim();
        if (formattedUrl.endsWith('/')) {
          formattedUrl = formattedUrl.slice(0, -1);
        }
        if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
          formattedUrl = `http://${formattedUrl}`;
        }
        
        // 创建临时API客户端
        const apiClient = createApiClient(formattedUrl);
        
        // 尝试连接到Emby系统信息API
        const response = await apiClient.get('/System/Info/Public', {
          timeout: 10000 // 10秒超时
        });
        
        if (response.status === 200 && response.data) {
          console.log('Emby服务器连接成功:', response.data);
          set({ isLoading: false, lastError: null, serverUrl: formattedUrl });
          return true;
        } else {
          const errorMsg = '无法验证Emby服务器';
          console.error(errorMsg);
          set({ isLoading: false, lastError: errorMsg });
          return false;
        }
      } catch (error: any) {
        let errorMsg = '连接到Emby服务器失败';
        
        if (error.code === 'ECONNREFUSED') {
          errorMsg = '无法连接到服务器，连接被拒绝';
        } else if (error.code === 'ECONNABORTED') {
          errorMsg = '连接超时，服务器响应时间过长';
        } else if (error.code === 'ENOTFOUND') {
          errorMsg = '找不到服务器，请检查URL是否正确';
        } else if (error.response) {
          errorMsg = `服务器返回错误: ${error.response.status} ${error.response.statusText}`;
        }
        
        console.error('Emby连接测试失败:', errorMsg, error);
        set({ isLoading: false, lastError: errorMsg });
        return false;
      }
    },
    
    // 登录Emby服务器
    login: async (serverId: string, username: string, password: string) => {
      try {
        const serverStore = useServerStore.getState();
        const server = serverStore.servers.find(s => s.id === serverId);
        
        if (!server) {
          set({ isLoading: false, lastError: '服务器配置不存在' });
          return false;
        }
        
        // 构建完整的服务器URL
        const port = server.port ? `:${server.port}` : '';
        const serverUrl = `${server.protocol}://${server.url}${port}`;
        
        set({ isLoading: true, lastError: null });
        
        console.log(`尝试登录Emby服务器: ${serverUrl}, 用户名: ${username}`);
        
        // 创建API客户端
        const apiClient = createApiClient(serverUrl);
        
        // 进行身份验证请求
        const authData = {
          Username: username,
          Pw: password
        };
        
        const response = await apiClient.post('/Users/AuthenticateByName', authData, {
          headers: {
            'X-Emby-Authorization': `MediaBrowser Client="Electron Player", Device="PC", DeviceId="electron-player", Version="1.0.0"`
          }
        });
        
        if (response.status === 200 && response.data && response.data.AccessToken) {
          const { AccessToken, User } = response.data;
          
          if (!User || !User.Id) {
            throw new Error('服务器响应中缺少用户信息');
          }
          
          // 更新状态
          set({
            token: AccessToken,
            userId: User.Id,
            username: User.Name,
            isLoggedIn: true,
            isLoading: false,
            lastError: null,
            serverUrl: serverUrl
          });
          
          // 保存到本地存储
          localStorage.setItem('emby_token', AccessToken);
          localStorage.setItem('emby_userId', User.Id);
          localStorage.setItem('emby_username', User.Name);
          localStorage.setItem('emby_serverUrl', serverUrl);
          
          // 设置当前活跃服务器
          serverStore.setActiveServer(serverId);
          
          // 如果用户名密码提供了，更新服务器配置
          if (username && password) {
            serverStore.updateServer(serverId, {
              username,
              password
            });
          }
          
          console.log('登录成功，用户ID:', User.Id, '用户名:', User.Name);
          return true;
        } else {
          throw new Error('服务器响应中缺少访问令牌');
        }
      } catch (error: any) {
        let errorMsg = '登录失败';
        
        if (error.response) {
          if (error.response.status === 401) {
            errorMsg = '用户名或密码错误';
          } else {
            errorMsg = `服务器错误: ${error.response.status}`;
          }
        } else if (error.code === 'ECONNABORTED') {
          errorMsg = '连接超时，请检查网络状态';
        } else if (error.code === 'ECONNREFUSED') {
          errorMsg = '无法连接到服务器，连接被拒绝';
        } else if (error.code === 'ENOTFOUND') {
          errorMsg = '找不到服务器，请检查URL是否正确';
        } else if (error.message) {
          errorMsg = error.message;
        }
        
        console.error('登录失败:', errorMsg, error);
        set({ 
          isLoggedIn: false, 
          isLoading: false, 
          lastError: errorMsg,
          token: '',
          userId: '',
          username: '',
          serverUrl: ''
        });
        return false;
      }
    },
    
    // 登出
    logout: () => {
      set({ 
        token: '', 
        userId: '', 
        username: '', 
        isLoggedIn: false,
        serverUrl: ''
      });
      
      // 清除本地存储中的登录信息
      localStorage.removeItem('emby_token');
      localStorage.removeItem('emby_userId');
      localStorage.removeItem('emby_username');
      localStorage.removeItem('emby_serverUrl');
      
      console.log('已登出');
    },
    
    // 获取API客户端实例
    getApiClient: () => {
      const { token } = get();
      const serverStore = useServerStore.getState();
      const activeServer = serverStore.getActiveServer();
      
      if (!activeServer) {
        console.error('无法创建API客户端：没有活跃的服务器配置');
        return null;
      }
      
      // 构建完整的服务器URL
      const port = activeServer.port ? `:${activeServer.port}` : '';
      const serverUrl = `${activeServer.protocol}://${activeServer.url}${port}`;
      
      // 每次调用都获取最新的服务器URL，而不是使用状态中的URL
      const currentServerUrl = localStorage.getItem('emby_serverUrl') || serverUrl;
      
      // 如果状态中的URL已过期，更新它
      if (currentServerUrl !== serverUrl) {
        set({ serverUrl: currentServerUrl });
      }
      
      // 创建axios实例时使用最新的URL
      const apiClient = axios.create({
        baseURL: currentServerUrl,
        headers: {
          'X-Emby-Token': token,
          'X-Emby-Authorization': `MediaBrowser Token="${token}"`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      // 添加响应拦截器，检测授权问题
      apiClient.interceptors.response.use(
        (response) => response,
        (error) => {
          if (error.response && error.response.status === 401) {
            console.error('Emby API授权失败，可能需要重新登录', error.response.data);
            // 使用消息通知用户
            message.error('Emby服务器授权失败，请重新登录');
          }
          return Promise.reject(error);
        }
      );
      
      return apiClient;
    },
    
    // 处理身份验证错误
    handleAuthenticationError: () => {
      // 清除登录状态
      get().logout();
    },
    
    // 设置服务器URL
    setServerUrl: (url: string) => {
      set({ serverUrl: url });
      localStorage.setItem('emby_serverUrl', url);
    }
  };
});

export default useEmbyStore; 