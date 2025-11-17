import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Import all styles
import './styles/theme.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/profile.css';
import './styles/admin.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
