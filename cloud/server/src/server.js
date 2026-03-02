/**
 * RouteLab API Server
 * 
 * This is the main entry point for the server.
 * All routes are mounted from the modular routes/ directory.
 */

const { app, upload } = require('./app');
const { PORT } = require('./config/index');
const { ensureDatabaseReady } = require('./db/index');

// Import API routes
const apiRoutes = require('./routes/index');

// Mount all API routes under /api
app.use('/api', apiRoutes);

// File upload endpoint (using multer from app.js)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const publicUrl = app.locals.buildPublicUrl(req.file.filename);
  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
    url: publicUrl,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
  try {
    await ensureDatabaseReady();
    app.listen(PORT, () => {
      console.log(`RouteLab API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize server', error);
    process.exit(1);
  }
}

startServer();
