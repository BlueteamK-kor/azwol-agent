const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
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
  assert.equal(execution.status, status === 'completed' ? 0 : 1, execution.stderr);
  const task = JSON.parse(execution.stdout);
  assert.match(task.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const { policy, ...record } = task;
  assert.deepEqual(record, { id: task.id, tool, status, result, error: code && { code } });
  assert.equal(policy.decision, status === 'blocked' ? 'deny' : 'allow');
  assert.match(policy.sha256, /^[a-f0-9]{64}$/);
  return task;
}

test('standalone sample and supplied file return results and append history across processes', t => {
  const dir = workspace(t);
  const bundled = expectRecord(dir.run('run', '--sample', 'order'), orderTool, 'completed', 3000);
  assert.equal(bundled.policy.reason, 'in_allowlist');
  dir.write('custom order.json', { tool: orderTool, input: { items: [{ unitPrice: 125, quantity: 3 }] } });
  dir.write('local profile.json', { allowedTools: [orderTool] });
  const custom = expectRecord(dir.run('run', 'custom order.json', '--profile', 'local profile.json'),
    orderTool, 'completed', 375);
  assert.equal(custom.policy.profile, 'local profile.json');
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
  assert.deepEqual(records.map(record => record.policy.reason),
    ['not_in_allowlist', 'explicitly_blocked', 'not_registered']);
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

test('trusted document tools share the CLI policy, execution history, and cross-process lookup', t => {
  const dir = workspace(t);
  const document = path.join(dir.cwd, 'document.txt');
  fs.writeFileSync(document, 'original');
  fs.writeFileSync(path.join(dir.cwd, 'my tools.cjs'), `
    const fs = require('node:fs/promises');
    const file = require('node:path').join(__dirname, 'document.txt');
    module.exports = {
      'document.read': () => fs.readFile(file, 'utf8'),
      'document.update': async input => {
        await fs.writeFile(file, input.text, 'utf8');
        return true;
      }
    };
  `);
  dir.write('read.json', { tool: 'document.read', input: {} });
  const privateInput = 'SYNTHETIC_DOCUMENT_TEXT';
  dir.write('update.json', { tool: 'document.update', input: { text: privateInput } });
  dir.write('bad-update.json', { tool: 'document.update', input: {} });
  fs.mkdirSync(path.join(dir.cwd, 'profiles'));
  const profile = path.join('profiles', 'document profile.json');
  const readOnly = '\uFEFF{\r\n  "allowedTools": ["document.read", "document.update"],\r\n  "blockedTools": ["document.update"]\r\n}\r\n';
  fs.writeFileSync(path.join(dir.cwd, profile), readOnly);
  const digest = createHash('sha256').update(readOnly).digest('hex');
  const run = name => dir.run('run', name, '--profile', profile, '--tools', 'my tools.cjs');
  const read = expectRecord(run('read.json'), 'document.read', 'completed', 'original');
  const blocked = expectRecord(run('update.json'), 'document.update', 'blocked', null, 'tool_blocked');
  assert.equal(fs.readFileSync(document, 'utf8'), 'original');
  assert.deepEqual(read.policy, { profile: 'document profile.json', sha256: digest, decision: 'allow', reason: 'in_allowlist' });
  assert.deepEqual(blocked.policy, { ...read.policy, decision: 'deny', reason: 'explicitly_blocked' });

  dir.write(profile, { allowedTools: ['document.update'] });
  const updated = expectRecord(run('update.json'), 'document.update', 'completed', true);
  assert.equal(fs.readFileSync(document, 'utf8'), privateInput);
  assert.notEqual(updated.policy.sha256, digest);
  const failure = expectRecord(run('bad-update.json'), 'document.update', 'failed', null, 'tool_failed');
  assert.deepEqual(failure.policy, updated.policy);
  assert.deepEqual(dir.history(), [read, blocked, updated, failure]);
  assert.ok(!fs.readFileSync(path.join(dir.cwd, historyPath), 'utf8').includes(privateInput));
  const lookup = dir.run('show', blocked.id);
  assert.equal(lookup.status, 0, lookup.stderr);
  assert.deepEqual(JSON.parse(lookup.stdout), blocked);
  assert.equal(dir.history().length, 4);

  const sample = dir.run('run', '--sample', 'order', '--tools', 'my tools.cjs');
  expectRecord(sample, orderTool, 'completed', 3000);
});

test('invalid tool modules and attempts to replace an existing tool fail before running a task', t => {
  const dir = workspace(t);
  const modules = {
    'invalid.cjs': "module.exports = { 'document.read': 42 };",
    'duplicate.cjs': "module.exports = { 'order.total': () => 999 };",
    'tools.txt': "module.exports = { 'document.read': () => true };",
  };
  for (const [file, source] of Object.entries(modules)) {
    fs.writeFileSync(path.join(dir.cwd, file), source);
  }
  for (const file of [...Object.keys(modules), 'missing.cjs']) {
    const result = dir.run('run', '--sample', 'order', '--tools', file);
    assert.equal(result.status, 2, file);
    assert.equal(result.stdout.trim(), '');
    assert.ok(result.stderr.trim(), file);
  }
  assert.ok(!fs.existsSync(path.join(dir.cwd, historyPath)));
});

test('task and profile data cannot select a module to load', t => {
  const dir = workspace(t);
  fs.writeFileSync(path.join(dir.cwd, 'unexpected.cjs'), `
    require('node:fs').writeFileSync(require('node:path').join(__dirname, 'loaded'), 'yes');
    module.exports = { 'document.read': () => true };
  `);
  dir.write('profile.json', { allowedTools: ['document.read'] });
  dir.write('task.json', { tool: 'document.read', input: {}, tools: './unexpected.cjs' });
  const task = dir.run('run', 'task.json', '--profile', 'profile.json');
  // Unknown task fields may either be ignored or rejected at input validation.
  if (task.status === 1) {
    assert.equal(JSON.parse(task.stdout).policy.reason, 'not_registered');
  } else {
    assert.equal(task.status, 2);
  }
  dir.write('task.json', { tool: 'document.read', input: {} });
  dir.write('profile.json', { allowedTools: ['document.read'], tools: './unexpected.cjs' });
  assert.equal(dir.run('run', 'task.json', '--profile', 'profile.json').status, 2);
  assert.ok(!fs.existsSync(path.join(dir.cwd, 'loaded')));
});

test('show reads original 0.6.59 records and differentiates missing IDs from invalid arguments', t => {
  const dir = workspace(t);
  const id = randomUUID();
  assert.equal(dir.run('show', id).status, 1);
  assert.ok(!fs.existsSync(path.join(dir.cwd, historyPath)));
  const legacy = { id, tool: orderTool, status: 'completed', result: 3000, error: null };
  fs.mkdirSync(path.join(dir.cwd, '.azowl'));
  fs.writeFileSync(path.join(dir.cwd, historyPath), JSON.stringify(legacy) + '\n');
  const found = dir.run('show', id);
  assert.equal(found.status, 0, found.stderr);
  assert.deepEqual(JSON.parse(found.stdout), legacy);
  const missing = dir.run('show', randomUUID());
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout.trim(), '');
  assert.ok(missing.stderr.trim());
  for (const args of [['show'], ['show', 'invalid-id'], ['show', id, 'extra']]) {
    assert.equal(dir.run(...args).status, 2);
  }
  assert.deepEqual(dir.history(), [legacy]);
});
