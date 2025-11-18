const fileManager = require('./file-manager');
const config = require('../config/saaa-config');

// Resolve sandbox path for different environments
const USER_DATA_PATH =
  typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : 'wxfile://usr';
const LOG_DIRECTORY = `${USER_DATA_PATH}/${config.logs?.directory || 'logs'}`;
const LOG_FILE = `${LOG_DIRECTORY}/${config.logs?.file || 'rlab.log'}`;
const LOG_MAX_SIZE = Number(config.logs?.maxSizeKB || 512) * 1024; // default 512 KB

function getFileSystemManager() {
  return typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function'
    ? wx.getFileSystemManager()
    : null;
}

function ensureLogFile(existingFsm) {
  const fsm = existingFsm || getFileSystemManager();
  if (!fsm) {
    return false;
  }

  try {
    fileManager.ensureDir(LOG_DIRECTORY);
  } catch (dirError) {
    console.warn('RouteLab: ensure log directory failed', dirError);
    return false;
  }

  try {
    fsm.accessSync(LOG_FILE);
  } catch (accessError) {
    try {
      fileManager.writeFile(LOG_FILE, '', { encoding: 'utf8' });
    } catch (writeErr) {
      console.warn('RouteLab: create log file failed', writeErr);
      return false;
    }
  }

  try {
    const stat = fsm.statSync(LOG_FILE);
    if (stat && typeof stat.size === 'number' && stat.size > LOG_MAX_SIZE) {
      fileManager.writeFile(LOG_FILE, '', { encoding: 'utf8' });
    }
  } catch (statError) {
    console.warn('RouteLab: stat log file failed', statError);
  }

  return true;
}

function serializeDetail(detail) {
  if (detail === undefined || detail === null) {
    return '';
  }
  if (typeof detail === 'string') {
    return detail;
  }
  try {
    return JSON.stringify(detail);
  } catch (err) {
    return String(detail);
  }
}

function append(level, message, detail) {
  try {
    const fsm = getFileSystemManager();
    if (!fsm || !ensureLogFile(fsm)) {
      return;
    }

    const levelText = typeof level === 'string' ? level.toUpperCase() : String(level);
    const messageText = typeof message === 'string' ? message : serializeDetail(message);
    const detailText = serializeDetail(detail);
    const timestamp = new Date().toISOString();
    const line = detailText
      ? `[${timestamp}] [${levelText}] ${messageText} ${detailText}\n`
      : `[${timestamp}] [${levelText}] ${messageText}\n`;

    fileManager.appendFile(LOG_FILE, typeof line === 'string' ? line : String(line), {
      encoding: 'utf8',
    });
  } catch (err) {
    console.warn('RouteLab: append log failed', err);
  }
}

function info(message, detail) {
  append('INFO', message, detail);
}

function warn(message, detail) {
  append('WARN', message, detail);
}

function error(message, detail) {
  append('ERROR', message, detail);
}

function logPromiseRejection(scope, err) {
  const detail = err?.errMsg || err?.message || err;
  append('ERROR', `${scope} failed`, detail);
}

module.exports = {
  ensureLogFile,
  info,
  warn,
  error,
  logPromiseRejection,
};
