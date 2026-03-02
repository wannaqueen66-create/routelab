# Server Code Architecture

This directory has been fully refactored from a monolithic `server.js` (7500+ lines) into a clean, modular architecture.

## Directory Structure

```
src/
├── config/                     # Configuration
│   ├── index.js               # Environment variables
│   └── constants.js           # Static constants, enums
├── db/                        # Database
│   └── index.js               # PostgreSQL connection pool
├── middlewares/               # Express Middlewares
│   └── ensureAuth.js          # JWT authentication
├── models/                    # Data Access Layer
│   └── routeModel.js          # Route, likes, comments CRUD
├── services/                  # Business Logic
│   ├── routeService.js        # Route analytics, calories
│   ├── geocodeService.js      # AMAP / OSM geocoding
│   ├── weatherService.js      # Weather API integration
│   ├── authService.js         # Token, WeChat, admin auth
│   └── adminService.js        # Analytics, backup, export
├── routes/                    # API Routes
│   ├── index.js               # Main router
│   ├── auth.js                # /api/login/*
│   ├── user.js                # /api/user/*
│   ├── routes.js              # /api/routes/*
│   ├── admin.js               # /api/admin/*
│   └── proxy.js               # /api/weather, /api/geocode
├── utils/                     # Utilities
│   ├── geo.js                 # Geographic calculations
│   ├── time.js                # Time utilities
│   ├── format.js              # Data formatting
│   └── common.js              # General helpers
├── app.js                     # Express app setup
└── server.js                  # Entry point (legacy, to be cleaned)
```

## Module Statistics

| Directory | Files | Total Size |
|-----------|-------|------------|
| services/ | 5 | ~53KB |
| routes/ | 6 | ~47KB |
| models/ | 1 | ~11KB |
| config/ | 2 | ~6KB |
| utils/ | 4 | ~7KB |
| db/ | 1 | ~5KB |
| middlewares/ | 1 | ~1KB |

**Total new modular code: ~130KB**

## API Endpoints

### Authentication
- `POST /api/login/admin` - Admin login
- `POST /api/login/wechat` - WeChat login

### User
- `GET /api/user/profile` - Get user profile
- `POST /api/user/profile` - Update profile
- `GET /api/user/settings` - Get settings
- `POST /api/user/settings` - Update settings
- `GET /api/user/achievements` - Get achievements
- `POST /api/user/achievements` - Update achievements

### Routes
- `GET /api/routes` - List user's routes
- `GET /api/routes/public` - List public routes
- `GET /api/routes/:id` - Get route detail
- `DELETE /api/routes/:id` - Delete route
- `POST /api/routes/:id/likes` - Like route
- `DELETE /api/routes/:id/likes` - Unlike route
- `GET /api/routes/:id/comments` - Get comments
- `POST /api/routes/:id/comments` - Add comment
- `DELETE /api/routes/:id/comments/:commentId` - Delete comment

### Admin
- `GET /api/admin/analytics/summary` - Analytics summary
- `GET /api/admin/analytics/timeseries` - Time series data
- `GET /api/admin/analytics/distribution` - Distribution data
- `GET /api/admin/users` - List users
- `GET /api/admin/users/:id` - User detail
- `GET /api/admin/routes` - List all routes
- `POST /api/admin/routes/bulk-delete` - Bulk delete
- `POST /api/admin/routes/export` - Export routes
- `GET /api/admin/backups` - List backups
- `POST /api/admin/backups` - Create backup

### Proxy
- `GET /api/weather` - Get weather data
- `GET /api/geocode/reverse` - Reverse geocoding

## Refactoring Complete ✅

The server has been fully refactored from a monolithic 7500+ line file to a clean modular architecture:

| Metric | Before | After |
|--------|--------|-------|
| `server.js` size | 222KB | 1.4KB |
| `server.js` lines | 6841 | 49 |
| Total files | 1 | 20+ |
| Architecture | Monolithic | Modular |

The entry point (`server.js`) now simply:
1. Imports the Express app from `app.js`
2. Mounts all routes from `routes/index.js`
3. Starts the server

All business logic, database operations, and route handlers are organized in their respective modules.

