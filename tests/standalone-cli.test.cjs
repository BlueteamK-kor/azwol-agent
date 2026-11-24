const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const cli = path.resolve(__dirname, '../standalone/agent.cjs');
const historyPath = path.join('.azowl', 'task-history.jsonl');
const orderTool = 'order.total';

function workspace(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'azwol standalone '));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return {
    cwd,
    write(name, value) {
      fs.writeFileSync(path.join(cwd, name), JSON.stringify(value));
    },
    run(...args) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd, encoding: 'utf8', timeout: 10_000, windowsHide: true,
        env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
      });
      if (result.error) throw result.error;
      assert.equal(result.signal, null);
      return result;
    },
    history() {
      return fs.readFileSync(path.join(cwd, historyPath), 'utf8').trimEnd()
        .split(/\r?\n/).map(line => JSON.parse(line));
    },
  };
}

function expectRecord(execution, tool, status, result, code = null) {
  assert.equal(execution.status === 0, status === 'completed', execution.stderr);
  const task = JSON.parse(execution.stdout);
  assert.match(task.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(task, { id: task.id, tool, status, result, error: code && { code } });
  return task;
}

test('standalone sample and supplied file return results and append history across processes', t => {
  const dir = workspace(t);
  const bundled = expectRecord(dir.run('run', '--sample', 'order'), orderTool, 'completed', 3000);
  dir.write('custom order.json', { tool: orderTool, input: { items: [{ unitPrice: 125, quantity: 3 }] } });
  dir.write('local profile.json', { allowedTools: [orderTool] });
  const custom = expectRecord(dir.run('run', 'custom order.json', '--profile', 'local profile.json'),
    orderTool, 'completed', 375);
  assert.notEqual(bundled.id, custom.id);
  assert.deepEqual(dir.history(), [bundled, custom]);
});

test('standalone policy blocks unlisted, explicitly blocked, and unregistered tools', t => {
  const dir = workspace(t);
  const records = [];
  for (const profile of [{ allowedTools: [] }, { allowedTools: [orderTool], blockedTools: [orderTool] }]) {
    dir.write('profile.json', profile);
    records.push(expectRecord(dir.run('run', '--sample', 'order', '--profile', 'profile.json'),
      orderTool, 'blocked', null, 'tool_blocked'));
  }
  dir.write('profile.json', { allowedTools: ['sample.unknown'] });
  dir.write('task.json', { tool: 'sample.unknown', input: {} });
  records.push(expectRecord(dir.run('run', 'task.json', '--profile', 'profile.json'),
    'sample.unknown', 'blocked', null, 'tool_blocked'));
  assert.deepEqual(dir.history(), records);
});

test('order tool rejects negative, fractional, nonfinite and overflowing amounts', t => {
  const dir = workspace(t);
  const records = [];
  for (const items of [
    [{ unitPrice: -1, quantity: 2 }],
    [{ unitPrice: 2, quantity: 0.5 }],
    [{ unitPrice: Number.MAX_SAFE_INTEGER, quantity: 2 }],
    [{ unitPrice: Number.MAX_SAFE_INTEGER, quantity: 1 }, { unitPrice: 1, quantity: 1 }],
  ]) {
    dir.write('order.json', { tool: orderTool, input: { items } });
    records.push(expectRecord(dir.run('run', 'order.json'), orderTool, 'failed', null, 'tool_failed'));
  }
  // 1e309 is valid JSON and parses to a nonfinite number in JavaScript.
  fs.writeFileSync(path.join(dir.cwd, 'order.json'),
    '{"tool":"order.total","input":{"items":[{"unitPrice":1e309,"quantity":1}]}}');
  records.push(expectRecord(dir.run('run', 'order.json'), orderTool, 'failed', null, 'tool_failed'));
  assert.deepEqual(dir.history(), records);
});

test('invalid files and missing run arguments produce diagnostics before submitting a task', t => {
  const dir = workspace(t);
  const privateText = 'SYNTHETIC_PRIVATE_ORDER_FIELD';
  fs.writeFileSync(path.join(dir.cwd, 'broken.json'), '{"' + privateText + '":');
  dir.write('profile.json', { allowedTools: false });
  for (const args of [
    ['run'], ['run', 'missing.json'], ['run', 'broken.json'],
    ['run', '--sample', 'order', '--profile', 'profile.json'],
  ]) {
    const execution = dir.run(...args);
    assert.notEqual(execution.status, 0);
    assert.equal(execution.stdout.trim(), '');
    assert.ok(execution.stderr.trim());
    assert.ok(!execution.stderr.includes(privateText));
  }
  assert.ok(!fs.existsSync(path.join(dir.cwd, historyPath)));
});
