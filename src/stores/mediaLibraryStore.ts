import create from 'zustand';
import { useEmbyStore } from './embyStore';

// 媒体库项目接口定义
export interface LibraryView {
  Name: string;
  CollectionType: string;
  Id: string;
  Type?: string;
  ImageTags?: {
    Primary?: string;
  };
}

// 媒体库存储接口
interface MediaLibraryState {
  libraries: LibraryView[];
  isLoading: boolean;
  error: string | null;
  selectedLibraryId: string | null;
  
  // 方法
  fetchLibraries: () => Promise<void>;
  selectLibrary: (id: string) => void;
  getLibraryImageUrl: (item: LibraryView) => string;
}

// 创建媒体库存储
export const useMediaLibraryStore = create<MediaLibraryState>((set, get) => ({
  libraries: [],
  isLoading: false,
  error: null,
  selectedLibraryId: null,
  
  // 获取用户可访问的媒体库列表
  fetchLibraries: async () => {
    const { getApiClient, userId, token } = useEmbyStore.getState();
    const apiClient = getApiClient();
    
    if (!apiClient || !userId) {
      set({ error: '未登录或API客户端不可用', isLoading: false });
      return;
    }
    
    set({ isLoading: true, error: null });
    
    try {
      // 调用接口获取媒体库视图列表
      const response = await apiClient.get(`/Users/${userId}/Views`);
      
      if (response.data && response.data.Items) {
        // 过滤掉没有CollectionType的媒体库，确保类型正确
        const libraries = response.data.Items.map((item: LibraryView) => {
          // 确保CollectionType存在，对于不同类型的媒体库进行标准化处理
          if (!item.CollectionType && item.Type) {
            // 如果没有CollectionType但有Type，尝试推断CollectionType
            switch (item.Type.toLowerCase()) {
              case 'moviescollection':
              case 'moviecollection':
                item.CollectionType = 'movies';
                break;
              case 'tvcollection':
              case 'tvshowscollection':
              case 'seriescollection':
                item.CollectionType = 'tvshows';
                break;
              case 'musiccollection':
              case 'albumcollection':
                item.CollectionType = 'music';
                break;
              case 'photocollection':
              case 'photoscollection':
                item.CollectionType = 'photos';
                break;
              default:
                item.CollectionType = item.Type.toLowerCase();
            }
          }
          return item;
        });
        
        set({ 
          libraries,
          isLoading: false,
          error: null
        });
      } else {
        set({ 
          libraries: [], 
          isLoading: false, 
          error: '获取媒体库列表失败：响应数据格式不符合预期' 
        });
      }
    } catch (error) {
      console.error('获取媒体库列表失败:', error);
      set({ 
        libraries: [], 
        isLoading: false, 
        error: '获取媒体库列表失败：' + (error instanceof Error ? error.message : String(error))
      });
    }
  },
  
  // 选择当前媒体库
  selectLibrary: (id: string) => {
    set({ selectedLibraryId: id });
  },
  
  // 获取媒体库封面图URL
  getLibraryImageUrl: (item: LibraryView) => {
    if (!item.ImageTags?.Primary) {
      return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzJhMmEyYSIgLz48dGV4dCB4PSI3NSIgeT0iNTAiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMnB4IiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBhbGlnbm1lbnQtYmFzZWxpbmU9Im1pZGRsZSI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+';
    }
    
    const { getApiClient, token } = useEmbyStore.getState();
    const apiClient = getApiClient();
    
    if (!apiClient) return '';
    
    const baseURL = apiClient.defaults.baseURL;
    return `${baseURL}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}&width=300&quality=90&api_key=${token}`;
  }
})); 