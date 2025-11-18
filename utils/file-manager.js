function getFileSystemManager() {
  if (typeof wx === 'undefined' || typeof wx.getFileSystemManager !== 'function') {
    return null;
  }
  try {
    return wx.getFileSystemManager();
  } catch (err) {
    console.warn('RouteLab: getFileSystemManager failed', err);
    return null;
  }
}

function ensureDir(dirPath) {
  if (!dirPath) {
    return;
  }
  const trimmedPath = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
  const fsm = getFileSystemManager();
  if (!fsm) {
    return;
  }
  try {
    fsm.mkdirSync(trimmedPath, true);
  } catch (mkdirError) {
    console.warn('RouteLab: mkdir failed', trimmedPath, mkdirError);
  }
}

function readFile(path, encoding = 'utf8') {
  if (!path) {
    return null;
  }
  const fsm = getFileSystemManager();
  if (!fsm) {
    return null;
  }
  try {
    return fsm.readFileSync(path, encoding);
  } catch (err) {
    console.warn('RouteLab: read file failed', path, err);
    return null;
  }
}

function resolveEncoding(options) {
  if (!options) {
    return 'utf8';
  }
  if (typeof options === 'string') {
    return options;
  }
  if (typeof options === 'object' && typeof options.encoding === 'string') {
    return options.encoding;
  }
  return 'utf8';
}

function toWritableData(data) {
  if (data === null || data === undefined) {
    return '';
  }
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return `[ArrayBuffer length=${data.byteLength}]`;
  }
  if (data && data.buffer instanceof ArrayBuffer) {
    const length = typeof data.length === 'number' ? data.length : data.byteLength || 0;
    return `[TypedArray length=${length}]`;
  }
  try {
    return JSON.stringify(data);
  } catch (err) {
    return String(data);
  }
}

function ensureParentDir(path) {
  if (!path) {
    return;
  }
  const lastSlashIndex = path.lastIndexOf('/');
  if (lastSlashIndex <= 0) {
    return;
  }
  const dir = path.slice(0, lastSlashIndex);
  ensureDir(dir);
}

function writeFile(path, data, options = { encoding: 'utf8' }) {
  if (!path) {
    return;
  }
  ensureParentDir(path);
  const fsm = getFileSystemManager();
  if (!fsm) {
    return;
  }
  const encoding = resolveEncoding(options);
  const payload = toWritableData(data);
  try {
    fsm.writeFileSync(path, payload, encoding);
  } catch (err) {
    console.warn('RouteLab: write file failed', path, err);
  }
}

function appendFile(path, data, options = { encoding: 'utf8' }) {
  if (!path) {
    return;
  }
  ensureParentDir(path);
  const fsm = getFileSystemManager();
  if (!fsm) {
    return;
  }
  const encoding = resolveEncoding(options);
  const payload = toWritableData(data);
  try {
    if (typeof fsm.appendFileSync === 'function') {
      fsm.appendFileSync(path, payload, encoding);
    } else {
      const previous = readFile(path, encoding) || '';
      fsm.writeFileSync(path, `${previous}${payload}`, encoding);
    }
  } catch (err) {
    console.warn('RouteLab: append file failed', path, err);
  }
}

function readJson(path) {
  const content = readFile(path, 'utf8');
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch (err) {
    console.warn('RouteLab: parse json failed', path, err);
    return null;
  }
}

function writeJson(path, data) {
  try {
    writeFile(path, JSON.stringify(data, null, 2), { encoding: 'utf8' });
  } catch (err) {
    console.warn('RouteLab: write json failed', path, err);
  }
}

module.exports = {
  ensureDir,
  readFile,
  writeFile,
  appendFile,
  readJson,
  writeJson,
};
