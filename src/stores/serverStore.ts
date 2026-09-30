import create from 'zustand';
import CryptoJS from 'crypto-js';

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

// 服务器配置接口
export interface ServerConfig {
  id: string;
  name: string;
  url: string;
  protocol: 'http' | 'https';
  port?: string;
  username?: string;
  password?: string;
  createdAt: number;
}

interface ServerState {
  servers: ServerConfig[];
  activeServerId: string | null;
  
  addServer: (server: Omit<ServerConfig, 'id' | 'createdAt'>) => string;
  updateServer: (id: string, updates: Partial<Omit<ServerConfig, 'id' | 'createdAt'>>) => boolean;
  deleteServer: (id: string) => boolean;
  setActiveServer: (id: string | null) => void;
  getActiveServer: () => ServerConfig | null;
  getAllServers: () => ServerConfig[];
}

// 生成唯一ID
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// 初始化存储
export const useServerStore = create<ServerState>((set, get) => {
  // 从本地存储加载状态
  const loadState = () => {
    try {
      const savedServersEncrypted = localStorage.getItem('emby_servers');
      const savedActiveServerId = localStorage.getItem('emby_active_server');
      
      let servers: ServerConfig[] = [];
      let activeServerId: string | null = null;
      
      if (savedServersEncrypted) {
        const serversJson = decryptData(savedServersEncrypted);
        servers = JSON.parse(serversJson);
      }
      
      if (savedActiveServerId) {
        activeServerId = decryptData(savedActiveServerId);
        // 确保活跃的服务器ID确实存在于服务器列表中
        if (!servers.some(server => server.id === activeServerId)) {
          activeServerId = servers.length > 0 ? servers[0].id : null;
        }
      }
      
      return {
        servers,
        activeServerId
      };
    } catch (error) {
      console.error('从本地存储加载服务器配置失败:', error);
      // 如果加载失败，清除本地存储
      localStorage.removeItem('emby_servers');
      localStorage.removeItem('emby_active_server');
      return {
        servers: [],
        activeServerId: null
      };
    }
  };
  
  const saveState = (servers: ServerConfig[], activeServerId: string | null) => {
    try {
      const serversJson = JSON.stringify(servers);
      localStorage.setItem('emby_servers', encryptData(serversJson));
      
      if (activeServerId) {
        localStorage.setItem('emby_active_server', encryptData(activeServerId));
      } else {
        localStorage.removeItem('emby_active_server');
      }
    } catch (error) {
      console.error('保存服务器配置到本地存储失败:', error);
    }
  };
  
  const initialState = loadState();
  
  return {
    ...initialState,
    
    addServer: (serverData) => {
      const newServer: ServerConfig = {
        ...serverData,
        id: generateId(),
        createdAt: Date.now()
      };
      
      const updatedServers = [...get().servers, newServer];
      
      // 如果这是第一个服务器，自动设为活跃
      const activeServerId = get().activeServerId || newServer.id;
      
      set({ 
        servers: updatedServers,
        activeServerId
      });
      
      saveState(updatedServers, activeServerId);
      
      return newServer.id;
    },
    
    updateServer: (id, updates) => {
      const servers = get().servers;
      const serverIndex = servers.findIndex(server => server.id === id);
      
      if (serverIndex === -1) return false;
      
      const updatedServers = [...servers];
      updatedServers[serverIndex] = {
        ...updatedServers[serverIndex],
        ...updates
      };
      
      set({ servers: updatedServers });
      saveState(updatedServers, get().activeServerId);
      
      return true;
    },
    
    deleteServer: (id) => {
      const servers = get().servers;
      const filteredServers = servers.filter(server => server.id !== id);
      
      if (filteredServers.length === servers.length) {
        return false; // 没有找到要删除的服务器
      }
      
      // 如果删除了活跃的服务器，选择第一个作为新的活跃服务器
      let activeServerId = get().activeServerId;
      if (activeServerId === id) {
        activeServerId = filteredServers.length > 0 ? filteredServers[0].id : null;
      }
      
      set({
        servers: filteredServers,
        activeServerId
      });
      
      saveState(filteredServers, activeServerId);
      
      return true;
    },
    
    setActiveServer: (id) => {
      // 验证服务器ID是否存在
      if (id !== null && !get().servers.some(server => server.id === id)) {
        console.error('尝试设置不存在的服务器ID:', id);
        return;
      }
      
      set({ activeServerId: id });
      saveState(get().servers, id);
      
      // 如果有活跃服务器，更新emby_serverUrl
      if (id) {
        const server = get().servers.find(s => s.id === id);
        if (server) {
          const port = server.port ? `:${server.port}` : '';
          const serverUrl = `${server.protocol}://${server.url}${port}`;
          localStorage.setItem('emby_serverUrl', serverUrl);
        }
      } else {
        // 如果没有活跃服务器，清除serverUrl
        localStorage.removeItem('emby_serverUrl');
      }
    },
    
    getActiveServer: () => {
      const { servers, activeServerId } = get();
      if (!activeServerId) return null;
      
      return servers.find(server => server.id === activeServerId) || null;
    },
    
    getAllServers: () => {
      return get().servers;
    }
  };
}); 