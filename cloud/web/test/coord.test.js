const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCoordModule() {
  const filePath = path.resolve(__dirname, '../src/utils/coord.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const transformed = source.replace('export function gcj02ToWgs84', 'function gcj02ToWgs84');
  const wrapped = `${transformed}\nmodule.exports = { gcj02ToWgs84 };`;

  const context = {
    module: { exports: {} },
    exports: {},
    require,
    console,
    Math,
  };

  vm.runInNewContext(wrapped, context, { filename: filePath });
  return context.module.exports;
}

const { gcj02ToWgs84 } = loadCoordModule();

test('gcj02ToWgs84 keeps out-of-china coordinates stable', () => {
  const result = gcj02ToWgs84(40.7128, -74.006);
  assert.equal(result.latitude, 40.7128);
  assert.equal(result.longitude, -74.006);
});

test('gcj02ToWgs84 returns numeric transformed values in China', () => {
  const result = gcj02ToWgs84(31.2304, 121.4737);
  assert.equal(typeof result.latitude, 'number');
  assert.equal(typeof result.longitude, 'number');
  assert.ok(Number.isFinite(result.latitude));
  assert.ok(Number.isFinite(result.longitude));
  assert.notEqual(result.latitude, 31.2304);
  assert.notEqual(result.longitude, 121.4737);
});

test('gcj02ToWgs84 returns NaN for invalid input', () => {
  const result = gcj02ToWgs84('bad-lat', 121.4737);
  assert.ok(Number.isNaN(result.latitude));
  assert.ok(Number.isNaN(result.longitude));
});
