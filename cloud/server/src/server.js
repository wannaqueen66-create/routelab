/**
 * RouteLab API Server
 *
 * This is the main entry point for the server.
 * All routes are mounted from the modular routes/ directory.
 */

const { app, upload } = require('./app');
const { PORT, JWT_SECRET } = require('./config/index');
const { ensureDatabaseReady } = require('./db/index');
const apiRoutes = require('./routes/index');
const createEnsureAuth = require('./middlewares/ensureAuth');

let routesRegistered = false;

function registerRoutes(targetApp = app) {
  if (routesRegistered) {
    return targetApp;
  }

  targetApp.use('/api', apiRoutes);

  const ensureAuth = createEnsureAuth({ jwtSecret: JWT_SECRET });
  targetApp.post('/api/upload', ensureAuth, upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const publicUrl = targetApp.locals.buildPublicUrl(req.file.filename);
    res.json({
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      url: publicUrl,
    });
  });

  targetApp.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  targetApp.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  routesRegistered = true;
  return targetApp;
}

async function startServer() {
  try {
    await ensureDatabaseReady();
    registerRoutes(app);
    app.listen(PORT, () => {
      console.log(`RouteLab API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize server', error);
    process.exit(1);
  }
}

if (require.main === module) {
  // Global error handlers to prevent silent crashes
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled Promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    process.exit(1);
  });

  startServer();
}

module.exports = {
  app,
  registerRoutes,
  startServer,
};
