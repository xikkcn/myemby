import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Spin, Empty, Typography, Input, Select, Tag, Space, Dropdown, Button, message, Pagination } from 'antd';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useEmbyStore } from '../stores/embyStore';
import { FilterOutlined, DownOutlined, SearchOutlined } from '@ant-design/icons';
import './Movies.scss';

const { Title } = Typography;
const { Search } = Input;
const { Option } = Select;

interface MovieItem {
  Id: string;
  Name: string;
  ImageTags: {
    Primary?: string;
  };
  ProductionYear?: number;
  Overview?: string;
  CommunityRating?: number;
  OfficialRating?: string;
  RunTimeTicks?: number;
  Genres?: string[];
  ProductionLocations?: string[]; // 制作国家/地区
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

const Movies: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  
  const [movies, setMovies] = useState<MovieItem[]>([]);
  const [filteredMovies, setFilteredMovies] = useState<MovieItem[]>([]);
  const [displayedMovies, setDisplayedMovies] = useState<MovieItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('ProductionYear,Descending');
  const { getApiClient, token } = useEmbyStore();
  const [serverUrl, setServerUrl] = useState<string>('');
  const { userId } = useEmbyStore();
  const [totalCount, setTotalCount] = useState<number>(0);
  const [libraryName, setLibraryName] = useState<string>('电影');
  
  // 获取库ID - 可能来自路由参数或location state
  const libraryId = params.id || (location.state as any)?.libraryId || null;
  
  // 分页配置
  const [pagination, setPagination] = useState<PaginationConfig>({
    current: 1,
    pageSize: 20,
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
    
    // 每当sortBy或libraryId变化，重新获取电影列表
    fetchMovies();
  }, [sortBy, libraryId]);

  // 当筛选条件或搜索词变化时，应用筛选
  useEffect(() => {
    if (movies.length > 0) {
      applyFilters();
    }
  }, [movies, filterOptions.selectedYear, filterOptions.selectedGenre, filterOptions.selectedCountry, searchTerm]);
  
  // 当筛选后的结果或分页变化时，更新显示的电影
  useEffect(() => {
    updateDisplayedMovies();
  }, [filteredMovies, pagination.current, pagination.pageSize]);

  const fetchMovies = async () => {
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
            setLibraryName('电影库');
          }
        } catch (error) {
          console.error('获取媒体库信息失败:', error);
          setLibraryName('电影库'); // 设置默认名称
        }
      }
      
      // 构建请求参数，如果有库ID则添加ParentId参数
      const params: any = {
        SortBy: sortField,
        SortOrder: sortOrder,
        IncludeItemTypes: 'Movie',
        Recursive: true,
        Fields: 'PrimaryImageAspectRatio,BasicSyncInfo,Overview,Genres,CommunityRating,OfficialRating,RunTimeTicks,ProductionLocations',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop',
        Limit: 200, // 获取更多数据用于本地筛选
      };
      
      // 如果有指定媒体库，则添加ParentId参数
      if (libraryId) {
        params.ParentId = libraryId;
      }
      
      const response = await apiClient.get(`/Users/${userId}/Items`, { params });
      
      const moviesList = response.data.Items || [];
      setMovies(moviesList);
      setTotalCount(response.data.TotalRecordCount || moviesList.length);
      
      // 提取所有年份、类型和国家，用于筛选
      const years = Array.from(new Set(
        moviesList
          .filter((movie: MovieItem) => movie.ProductionYear)
          .map((movie: MovieItem) => movie.ProductionYear)
      )).sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') {
          return b - a; // 降序排列年份
        }
        return 0;
      });
      
      const genres = Array.from(new Set(
        moviesList
          .filter((movie: MovieItem) => movie.Genres && movie.Genres.length > 0)
          .flatMap((movie: MovieItem) => movie.Genres || [])
      )).sort();
      
      const countries = Array.from(new Set(
        moviesList
          .filter((movie: MovieItem) => movie.ProductionLocations && movie.ProductionLocations.length > 0)
          .flatMap((movie: MovieItem) => movie.ProductionLocations || [])
      )).sort();
      
      setFilterOptions(prev => ({
        ...prev,
        years: years as number[],
        genres: genres as string[],
        countries: countries as string[]
      }));
      
    } catch (error) {
      console.error('获取电影列表失败:', error);
      message.error('获取电影列表失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  // 应用所有筛选条件
  const applyFilters = () => {
    let result = [...movies];
    
    // 应用搜索
    if (searchTerm) {
      result = result.filter(movie => 
        movie.Name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // 应用年份筛选
    if (filterOptions.selectedYear !== null) {
      result = result.filter(movie => movie.ProductionYear === filterOptions.selectedYear);
    }
    
    // 应用类型筛选
    if (filterOptions.selectedGenre !== null && filterOptions.selectedGenre !== '') {
      result = result.filter(movie => 
        movie.Genres && movie.Genres.some(genre => genre === filterOptions.selectedGenre)
      );
    }
    
    // 应用国家筛选
    if (filterOptions.selectedCountry !== null && filterOptions.selectedCountry !== '') {
      result = result.filter(movie => 
        movie.ProductionLocations && movie.ProductionLocations.some(country => country === filterOptions.selectedCountry)
      );
    }
    
    setFilteredMovies(result);
    
    // 重置分页到第一页
    setPagination(prev => ({
      ...prev,
      current: 1,
      total: result.length
    }));
  };
  
  // 更新当前页显示的电影
  const updateDisplayedMovies = () => {
    const { current, pageSize } = pagination;
    const startIndex = (current - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    
    setDisplayedMovies(filteredMovies.slice(startIndex, endIndex));
  };

  const getImageUrl = (item: MovieItem) => {
    if (item.ImageTags?.Primary) {
      return `${serverUrl}/Items/${item.Id}/Images/Primary?width=300&quality=90&api_key=${token}`;
    }
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjIyNSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjIyNSIgZmlsbD0iI2VlZjFmNSIgLz48dGV4dCB4PSI3NSIgeT0iMTEyLjUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMnB4IiBmaWxsPSIjYjBiN2MzIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBhbGlnbm1lbnQtYmFzZWxpbmU9Im1pZGRsZSI+Tm8gSW1hZ2U8L3RleHQ+PC9zdmc+';
  };

  const handleMovieClick = (item: MovieItem) => {
    navigate(`/player/${item.Id}`);
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

  const formatRuntime = (ticks?: number) => {
    if (!ticks) return '';
    // Emby使用的是100纳秒为单位的ticks
    const minutes = Math.floor(ticks / (10000 * 1000 * 60));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (hours > 0) {
      return `${hours}小时${remainingMinutes > 0 ? ` ${remainingMinutes}分钟` : ''}`;
    }
    return `${minutes}分钟`;
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
    <div className="movies-page">
      <div className="movies-header">
        <Title level={2}>{libraryId ? libraryName : '电影库'}</Title>
        <div className="movies-filter">
          <Search
            placeholder="搜索电影"
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
      ) : displayedMovies.length === 0 ? (
        <Empty description="没有找到符合条件的电影" />
      ) : (
        <>
          <Row gutter={[16, 24]} className="movies-grid">
            {displayedMovies.map((movie) => (
              <Col key={movie.Id} xs={12} sm={8} md={6} lg={4} xl={4}>
                <Card
                  hoverable
                  cover={
                    <div className="movie-cover-container">
                      <img alt={movie.Name} src={getImageUrl(movie)} />
                      <div className="movie-overlay">
                        <div className="movie-play-button">播放</div>
                      </div>
                      {movie.Genres && movie.Genres.length > 0 && (
                        <div className="movie-genre-tag">{movie.Genres[0]}</div>
                      )}
                    </div>
                  }
                  onClick={() => handleMovieClick(movie)}
                  className="movie-card"
                >
                  <Card.Meta
                    title={movie.Name}
                    description={
                      <div className="movie-details">
                        <div>{movie.ProductionYear || '未知年份'}</div>
                        {movie.RunTimeTicks && (
                          <div>{formatRuntime(movie.RunTimeTicks)}</div>
                        )}
                        {movie.OfficialRating && (
                          <div className="movie-rating">{movie.OfficialRating}</div>
                        )}
                      </div>
                    }
                  />
                </Card>
              </Col>
            ))}
          </Row>
          {filteredMovies.length > 0 && (
            <div className="pagination-container">
              <Pagination
                current={pagination.current}
                pageSize={pagination.pageSize}
                total={filteredMovies.length}
                onChange={handlePageChange}
                showSizeChanger
                showQuickJumper
                showTotal={(total) => `共 ${total} 部电影`}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Movies; 