/**
 * Routes Index
 * Main router that aggregates all sub-routers
 */

const express = require('express');

// Import sub-routers
const authRoutes = require('./auth');
const userRoutes = require('./user');
const routeRoutes = require('./routes');
const adminRoutes = require('./admin');
const proxyRoutes = require('./proxy');
const announcementRoutes = require('./announcements');
const publicRoutes = require('./public');

const router = express.Router();

// Health check
router.get('/ping', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
});

// Mount sub-routers
router.use('/login', authRoutes);
router.use('/user', userRoutes);
router.use('/routes', routeRoutes);
router.use('/admin', adminRoutes);
router.use('/announcements', announcementRoutes);
router.use('/public', publicRoutes);
router.use('/', proxyRoutes); // For /weather, /geocode

module.exports = router;
