import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Spin, Empty, Typography, Input, Select, Tag, Space, Dropdown, Button, message, Pagination } from 'antd';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useEmbyStore } from '../stores/embyStore';
import { DownOutlined, SearchOutlined } from '@ant-design/icons';
import './Series.scss';

const { Title } = Typography;
const { Search } = Input;
const { Option } = Select;

interface SeriesItem {
  Id: string;
  Name: string;
  ImageTags: {
    Primary?: string;
  };
  ProductionYear?: number;
  Overview?: string;
  CommunityRating?: number;
  OfficialRating?: string;
  Status?: string;
  ChildCount?: number;
  Genres?: string[];
  ProductionLocations?: string[];
}

// 筛选类型定义
interface FilterOptions {
  years: number[];
  genres: string[];
  countries: string[];
  selectedYear: number | null;
  selectedGenre: string | null;
  selectedCountry: string | null;
}

// 分页配置
interface PaginationConfig {
  current: number;
  pageSize: number;
  total: number;
}

const Series: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const [seriesList, setSeriesList] = useState<SeriesItem[]>([]);
  const [filteredSeries, setFilteredSeries] = useState<SeriesItem[]>([]);
  const [displayedSeries, setDisplayedSeries] = useState<SeriesItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('SortName,Ascending');
  const { getApiClient, userId, token } = useEmbyStore();
  const [serverUrl, setServerUrl] = useState<string>('');
  const [totalCount, setTotalCount] = useState<number>(0);
  const [libraryName, setLibraryName] = useState<string>('剧集');
  const [processedSeriesId, setProcessedSeriesId] = useState<string | null>(null);
  
  // 获取库ID - 可能来自路由参数或location state
  const libraryId = params.id || (location.state as any)?.libraryId || null;
  
  // 分页配置
  const [pagination, setPagination] = useState<PaginationConfig>({
    current: 1,
    pageSize: 18,
    total: 0
  });
  
  // 筛选选项状态
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    years: [],
    genres: [],
    countries: [],
    selectedYear: null,
    selectedGenre: null,
    selectedCountry: null
  });

  useEffect(() => {
    // 初始化服务器URL
    const apiClient = getApiClient();
    if (apiClient?.defaults?.baseURL) {
      setServerUrl(apiClient.defaults.baseURL);
    }
    
    // 每当sortBy或libraryId变化，重新获取剧集列表
    fetchSeries();
  }, [sortBy, libraryId]);
  
  // 添加一个新的useEffect来处理直接访问特定系列的情况
  useEffect(() => {
    // 如果有ID参数且尚未处理过该ID，表示需要查看特定剧集的详情
    if (params.id && params.id !== processedSeriesId && !loading && seriesList.length > 0) {
      // 先标记该ID为已处理，防止重复处理
      setProcessedSeriesId(params.id);
      
      // 查找当前列表中匹配的剧集
      const selectedSeries = seriesList.find(series => series.Id === params.id);
      if (selectedSeries) {
        // 如果找到匹配的剧集，则自动触发点击操作
        console.log(`找到匹配的剧集: ${selectedSeries.Name}，准备获取季和剧集信息`);
        handleSeriesClick(selectedSeries);
      } else {
        // 如果当前列表中没有找到，尝试单独获取该剧集信息
        fetchSingleSeries(params.id);
      }
    }
  }, [params.id, processedSeriesId, loading, seriesList]);

  // 当搜索词变化时，过滤剧集
  useEffect(() => {
    if (seriesList.length > 0) {
      applyFilters();
    }
  }, [seriesList, searchTerm]);
  
  // 当过滤后的结果或分页变化时，更新显示的剧集
  useEffect(() => {
    updateDisplayedSeries();
  }, [filteredSeries, pagination.current, pagination.pageSize]);

  // 添加一个单独的useEffect来监测params.id的变化并重置处理状态
  useEffect(() => {
    // 当URL中的ID参数变化时，重置处理状态
    if (params.id !== processedSeriesId) {
      setProcessedSeriesId(null);
    }
  }, [params.id]);

  const fetchSeries = async () => {
    setLoading(true);
    try {
      const apiClient = getApiClient();
      const [sortField, sortOrder] = sortBy.split(',');
      
      // 如果有特定的库ID，则获取该库的信息
      if (libraryId) {
        try {
          // 直接使用/Items/{id}获取媒体库信息会出现404错误
          // 改用Views API获取媒体库名称
          const viewsResponse = await apiClient.get(`/Users/${userId}/Views`);
          const libraryView = viewsResponse.data?.Items?.find((view: {Id: string, Name: string}) => view.Id === libraryId);
          if (libraryView && libraryView.Name) {
            setLibraryName(libraryView.Name);
          } else {
            setLibraryName('剧集库');
          }
        } catch (error) {
          console.error('获取媒体库信息失败:', error);
          setLibraryName('剧集库'); // 设置默认名称
        }
      }
      
      // 构建请求参数
      const params: any = {
        SortBy: sortField,
        SortOrder: sortOrder,
        IncludeItemTypes: 'Series',
        Recursive: true,
        Fields: 'PrimaryImageAspectRatio,BasicSyncInfo,Overview,Genres,CommunityRating,Status',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop',
        Limit: 200,
      };
      
      // 如果有指定媒体库，则添加ParentId参数
      if (libraryId) {
        params.ParentId = libraryId;
      }
      
      const response = await apiClient.get(`/Users/${userId}/Items`, { params });
      
      const seriesList = response.data.Items || [];
      setSeriesList(seriesList);
      setTotalCount(response.data.TotalRecordCount || seriesList.length);
      
      // 提取所有年份、类型和国家，用于筛选
      const years = Array.from(new Set(
        seriesList
          .filter((series: SeriesItem) => series.ProductionYear)
          .map((series: SeriesItem) => series.ProductionYear)
      )).sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') {
          return b - a; // 降序排列年份
        }
        return 0;
      });
      
      const genres = Array.from(new Set(
        seriesList
          .filter((series: SeriesItem) => series.Genres && series.Genres.length > 0)
          .flatMap((series: SeriesItem) => series.Genres || [])
      )).sort();
      
      const countries = Array.from(new Set(
        seriesList
          .filter((series: SeriesItem) => series.ProductionLocations && series.ProductionLocations.length > 0)
          .flatMap((series: SeriesItem) => series.ProductionLocations || [])
      )).sort();
      
      setFilterOptions(prev => ({
        ...prev,
        years: years as number[],
        genres: genres as string[],
        countries: countries as string[]
      }));
      
    } catch (error) {
      console.error('获取剧集列表失败:', error);
      message.error('获取剧集列表失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  // 添加获取单个剧集信息的函数
  const fetchSingleSeries = async (id: string) => {
    try {
      console.log(`正在获取剧集ID: ${id} 的详细信息`);
      const apiClient = getApiClient();
      
      // 获取特定剧集的详细信息
      const response = await apiClient.get(`/Users/${userId}/Items/${id}`, {
        params: {
          Fields: 'PrimaryImageAspectRatio,BasicSyncInfo,Overview,Genres,CommunityRating,Status'
        }
      });
      
      if (response.data && response.data.Type === 'Series') {
        // 找到了剧集，直接处理
        console.log(`成功获取剧集: ${response.data.Name}，准备获取季和剧集信息`);
        handleSeriesClick(response.data);
      } else {
        console.error('无法找到指定的剧集或返回的不是剧集类型');
        message.error('无法找到指定的剧集');
      }
    } catch (error) {
      console.error('获取特定剧集信息失败:', error);
      message.error('获取剧集信息失败，请检查网络连接');
    }
  };

  // 应用所有筛选条件
  const applyFilters = () => {
    let result = [...seriesList];
    
    // 应用搜索
    if (searchTerm) {
      result = result.filter(series => 
        series.Name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // 应用年份筛选
    if (filterOptions.selectedYear !== null) {
      result = result.filter(series => series.ProductionYear === filterOptions.selectedYear);
    }
    
    // 应用类型筛选
    if (filterOptions.selectedGenre !== null && filterOptions.selectedGenre !== '') {
      result = result.filter(series => 
        series.Genres && series.Genres.some(genre => genre === filterOptions.selectedGenre)
      );
    }
    
    // 应用国家筛选
    if (filterOptions.selectedCountry !== null && filterOptions.selectedCountry !== '') {
      result = result.filter(series => 
        series.ProductionLocations && series.ProductionLocations.some(country => country === filterOptions.selectedCountry)
      );
    }
    
    setFilteredSeries(result);
    
    // 重置分页到第一页
    setPagination(prev => ({
      ...prev,
      current: 1,
      total: result.length
    }));
  };
  
  // 更新当前页显示的剧集
  const updateDisplayedSeries = () => {
    const { current, pageSize } = pagination;
    const startIndex = (current - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    
    setDisplayedSeries(filteredSeries.slice(startIndex, endIndex));
  };

  const getImageUrl = (item: SeriesItem) => {
    if (item.ImageTags?.Primary) {
      return `${serverUrl}/Items/${item.Id}/Images/Primary?width=300&quality=90&api_key=${token}`;
    }
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjIyNSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjIyNSIgZmlsbD0iI2VlZjFmNSIgLz48dGV4dCB4PSI3NSIgeT0iMTEyLjUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMnB4IiBmaWxsPSIjYjBiN2MzIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBhbGlnbm1lbnQtYmFzZWxpbmU9Im1pZGRsZSI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+';
  };

  const handleSeriesClick = async (item: SeriesItem) => {
    try {
      setLoading(true);
      
      const apiClient = getApiClient();
      console.log(`获取剧集系列 ${item.Name} (ID: ${item.Id}) 的第一季...`);
      
      // 获取该系列的所有季 - 修正API调用
      const seasonsResponse = await apiClient.get(`/Shows/${item.Id}/Seasons`, {
        params: { 
          userId,
          Fields: 'ItemCounts,ChildCount',  // 添加字段以获取更多信息
          SortBy: 'SortName',  // 按名称排序
          SortOrder: 'Ascending'  // 升序
        }
      });
      
      console.log('API响应 - 季节数据:', seasonsResponse.data);
      
      if (seasonsResponse.data && seasonsResponse.data.Items && seasonsResponse.data.Items.length > 0) {
        // 按季号排序
        const seasons = seasonsResponse.data.Items
          .filter((season: any) => season.Type === 'Season') // 确保只处理季类型
          .sort((a: any, b: any) => (a.IndexNumber || 0) - (b.IndexNumber || 0));
        
        if (seasons.length === 0) {
          console.error('未找到有效的季数据');
          message.error('此剧集没有有效的季数据');
          setLoading(false);
          return;
        }
        
        const firstSeason = seasons[0];
        console.log(`获取第一季 ${firstSeason.Name} (ID: ${firstSeason.Id}) 的剧集...`);
        
        // 获取第一季的所有剧集 - 修正API调用
        const episodesResponse = await apiClient.get(`/Users/${userId}/Items`, {
          params: {
            ParentId: firstSeason.Id,  // 使用季的ID作为父ID
            Fields: 'Overview,PremiereDate',
            IncludeItemTypes: 'Episode',  // 只包含剧集类型
            Recursive: true,
            SortBy: 'SortName,PremiereDate',  // 按名称和首播日期排序
            SortOrder: 'Ascending'  // 升序
          }
        });
        
        console.log('API响应 - 剧集数据:', episodesResponse.data);
        
        if (episodesResponse.data && episodesResponse.data.Items && episodesResponse.data.Items.length > 0) {
          // 按集号排序
          const episodes = episodesResponse.data.Items
            .filter((episode: any) => episode.Type === 'Episode') // 确保只处理剧集类型
            .sort((a: any, b: any) => (a.IndexNumber || 0) - (b.IndexNumber || 0));
          
          if (episodes.length === 0) {
            console.error('未找到有效的剧集');
            message.error('未找到任何可播放的剧集');
            setLoading(false);
            return;
          }
          
          const firstEpisode = episodes[0];
          console.log(`准备播放第一集: ${firstEpisode.Name} (ID: ${firstEpisode.Id})`);
          
          // 导航到第一集
          navigate(`/player/${firstEpisode.Id}`);
          setLoading(false);
          return;
        } else {
          console.error('未找到第一季的任何剧集', episodesResponse);
          message.error('未找到任何可播放的剧集');
        }
      } else {
        console.error('未找到任何季', seasonsResponse);
        message.error('未找到任何可播放的季');
      }
      
      setLoading(false);
    } catch (error) {
      console.error('获取剧集信息失败:', error);
      message.error('获取剧集信息失败，请稍后重试');
      setLoading(false);
    }
  };

  // 处理搜索提交
  const handleSearch = (value: string) => {
    setSearchTerm(value);
  };

  const handleSortChange = (value: string) => {
    setSortBy(value);
  };

  const handleYearChange = (year: number | null) => {
    setFilterOptions(prev => ({
      ...prev,
      selectedYear: year
    }));
  };

  const handleGenreChange = (genre: string | null) => {
    setFilterOptions(prev => ({
      ...prev,
      selectedGenre: genre
    }));
  };

  const handleCountryChange = (country: string | null) => {
    setFilterOptions(prev => ({
      ...prev,
      selectedCountry: country
    }));
  };

  const clearFilters = () => {
    setFilterOptions(prev => ({
      ...prev,
      selectedYear: null,
      selectedGenre: null,
      selectedCountry: null
    }));
  };
  
  // 处理分页变化
  const handlePageChange = (page: number, pageSize?: number) => {
    setPagination(prev => ({
      ...prev,
      current: page,
      pageSize: pageSize || prev.pageSize
    }));
  };
  
  // 渲染已选筛选条件标签
  const renderFilterTags = () => {
    const tags = [];
    
    if (filterOptions.selectedYear !== null) {
      tags.push(
        <Tag 
          key="year" 
          closable 
          onClose={() => handleYearChange(null)}
        >
          年份: {filterOptions.selectedYear}
        </Tag>
      );
    }
    
    if (filterOptions.selectedGenre) {
      tags.push(
        <Tag 
          key="genre" 
          closable 
          onClose={() => handleGenreChange(null)}
        >
          类型: {filterOptions.selectedGenre}
        </Tag>
      );
    }
    
    if (filterOptions.selectedCountry) {
      tags.push(
        <Tag 
          key="country" 
          closable 
          onClose={() => handleCountryChange(null)}
        >
          国家/地区: {filterOptions.selectedCountry}
        </Tag>
      );
    }
    
    return tags.length > 0 ? (
      <Space style={{ marginTop: 16, marginBottom: 16 }}>
        {tags}
        {tags.length > 0 && (
          <Button size="small" onClick={clearFilters}>清除所有</Button>
        )}
      </Space>
    ) : null;
  };

  // 年份筛选下拉菜单
  const yearMenu = {
    items: [
      {
        key: 'all',
        label: '全部年份',
        onClick: () => handleYearChange(null)
      },
      ...filterOptions.years.map((year: number) => ({
        key: year.toString(),
        label: year.toString(),
        onClick: () => handleYearChange(year)
      }))
    ]
  };
  
  // 类型筛选下拉菜单
  const genreMenu = {
    items: [
      {
        key: 'all',
        label: '全部类型',
        onClick: () => handleGenreChange(null)
      },
      ...filterOptions.genres.map((genre: string) => ({
        key: genre,
        label: genre,
        onClick: () => handleGenreChange(genre)
      }))
    ]
  };
  
  // 国家筛选下拉菜单
  const countryMenu = {
    items: [
      {
        key: 'all',
        label: '全部国家/地区',
        onClick: () => handleCountryChange(null)
      },
      ...filterOptions.countries.map((country: string) => ({
        key: country,
        label: country,
        onClick: () => handleCountryChange(country)
      }))
    ]
  };

  return (
    <div className="series-container">
      <div className="series-header">
        <Title level={2}>{libraryId ? libraryName : '剧集库'}</Title>
        <div className="series-actions">
          <Search
            placeholder="搜索剧集"
            allowClear
            onSearch={handleSearch}
            style={{ width: 250, marginRight: 16 }}
            enterButton={<SearchOutlined />}
          />
          <Select 
            defaultValue={sortBy} 
            style={{ width: 150 }} 
            onChange={handleSortChange}
          >
            <Option value="DateCreated,Descending">最近添加</Option>
            <Option value="SortName,Ascending">名称 A-Z</Option>
            <Option value="SortName,Descending">名称 Z-A</Option>
            <Option value="ProductionYear,Descending">年份 新-旧</Option>
            <Option value="ProductionYear,Ascending">年份 旧-新</Option>
            <Option value="CommunityRating,Descending">评分 高-低</Option>
          </Select>
        </div>
      </div>
      
      <div className="filter-section">
        <Space size="middle">
          <Dropdown menu={yearMenu} disabled={filterOptions.years.length === 0}>
            <Button>
              <Space>
                年份
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>
          
          <Dropdown menu={genreMenu} disabled={filterOptions.genres.length === 0}>
            <Button>
              <Space>
                类型
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>
          
          <Dropdown menu={countryMenu} disabled={filterOptions.countries.length === 0}>
            <Button>
              <Space>
                国家/地区
                <DownOutlined />
              </Space>
            </Button>
          </Dropdown>
        </Space>
        
        {renderFilterTags()}
      </div>

      {loading ? (
        <div className="loading-container">
          <Spin size="large" />
        </div>
      ) : displayedSeries.length === 0 && libraryId === undefined ? (
        <Empty description="没有找到符合条件的剧集" />
      ) : (
        <>
          <Row gutter={[16, 24]} className="series-grid">
            {displayedSeries.map((series) => (
              <Col key={series.Id} xs={8} sm={6} md={6} lg={4} xl={4}>
                <Card
                  hoverable
                  cover={
                    <div className="series-cover-container">
                      <img alt={series.Name} src={getImageUrl(series)} />
                      <div className="series-overlay">
                        <div className="series-play-button">播放</div>
                      </div>
                      {series.Genres && series.Genres.length > 0 && (
                        <div className="series-genre-tag">{series.Genres[0]}</div>
                      )}
                    </div>
                  }
                  onClick={() => handleSeriesClick(series)}
                  className="series-card"
                >
                  <Card.Meta
                    title={series.Name}
                    description={
                      <div className="series-details">
                        <div>
                          {series.ProductionYear || '未知年份'}
                          {series.Status === 'Continuing' && ' · 连载中'}
                        </div>
                        {series.ChildCount !== undefined && (
                          <div>{series.ChildCount}季</div>
                        )}
                        {series.OfficialRating && (
                          <div className="series-rating">{series.OfficialRating}</div>
                        )}
                      </div>
                    }
                  />
                </Card>
              </Col>
            ))}
          </Row>
          {filteredSeries.length > 0 && (
            <div className="pagination-container">
              <Pagination
                current={pagination.current}
                pageSize={pagination.pageSize}
                total={filteredSeries.length}
                onChange={handlePageChange}
                showSizeChanger
                showQuickJumper
                showTotal={(total) => `共 ${total} 部剧集`}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Series; 