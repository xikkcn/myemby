import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { isTVMode } from './platform';
import { startSpatialNavigation } from './platform/spatialNav';
import './index.css';
import './styles/tv.scss';

// 电视端：开启遥控器方向键导航
if (isTVMode()) {
  startSpatialNavigation();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
