'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { types } = require('node:util');

const DEFAULT_HISTORY_LIMIT = 100;
const MAX_RESULT_DEPTH = 64;
const MAX_RESULT_VALUES = 10000;
const MAX_RESULT_TEXT_BYTES = 1024 * 1024;

// Adapted from the desktop artifact receipt check. See LICENSE.desktop and NOTICE.
function verifyArtifactReceipt(input) {
  if (input === null || typeof input !== 'object') return false;
  try {
    const { bytes, sizeBytes, sha256 } = input;
    if (!types.isUint8Array(bytes) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0 ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || bytes.byteLength !== sizeBytes) {
      return false;
    }
    // Hash the same byte snapshot whose length we check, including for sliced views.
    const snapshot = new Uint8Array(bytes);
    return snapshot.byteLength === sizeBytes && createHash('sha256').update(snapshot).digest('hex') === sha256;
  } catch {
    return false;
  }
}

function assertToolName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new TypeError('Expected a nonempty tool name of at most 128 characters without control characters.');
  }
}

function toolNames(names) {
  if (!Array.isArray(names)) throw new TypeError('Expected an array of tool names.');
  const result = new Set();
  for (const name of names) {
    assertToolName(name);
    result.add(name);
  }
  return result;
}

// Build a detached JSON value without invoking accessors or silently dropping data.
function copyResult(value) {
  const ancestors = new Set();
  let values = 0;
  let textBytes = 0;

  function countText(text) {
    textBytes += Buffer.byteLength(text, 'utf8');
    if (textBytes > MAX_RESULT_TEXT_BYTES) throw new TypeError();
  }

  function property(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError();
    return copy(descriptor.value);
  }

  function copy(item) {
    if (++values > MAX_RESULT_VALUES) throw new TypeError();
    if (typeof item === 'string') {
      countText(item);
      return item;
    }
    if (item === null || typeof item === 'boolean' || Number.isFinite(item)) return item;
    if (typeof item !== 'object' || types.isProxy(item) || ancestors.has(item) || ancestors.size >= MAX_RESULT_DEPTH) {
      throw new TypeError();
    }
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== null && prototype !== Object.prototype) throw new TypeError();
    ancestors.add(item);
    const keys = Reflect.ownKeys(item);
    let result;
    if (array) {
      if (keys.length !== item.length + 1 || item.length > MAX_RESULT_VALUES - values) throw new TypeError();
      result = Array.from({ length: item.length }, (_, index) => property(item, String(index)));
    } else {
      if (keys.length > MAX_RESULT_VALUES - values) throw new TypeError();
      result = Object.fromEntries(keys.map(key => {
        if (typeof key !== 'string') throw new TypeError();
        countText(key);
        return [key, property(item, key)];
      }));
    }
    ancestors.delete(item);
    return result;
  }
  return copy(value);
}

class LocalAgent {
  #tools = new Map();
  #allowed;
  #blocked;
  #running = new Map();
  #history = new Map();
  #historyLimit;

  constructor({ tools, allowedTools, blockedTools = [], historyLimit = DEFAULT_HISTORY_LIMIT }) {
    if (tools === null || typeof tools !== 'object' || Array.isArray(tools)) throw new TypeError('Expected a tool registry.');
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 0) throw new RangeError('Expected a nonnegative history limit.');
    for (const name of Object.keys(tools)) {
      assertToolName(name);
      const descriptor = Object.getOwnPropertyDescriptor(tools, name);
      if (typeof descriptor.value !== 'function') throw new TypeError('Expected a tool handler function.');
      this.#tools.set(name, descriptor.value);
    }
    this.#allowed = toolNames(allowedTools);
    this.#blocked = toolNames(blockedTools);
    this.#historyLimit = historyLimit;
  }

  get(taskId) {
    const task = this.#running.get(taskId) ?? this.#history.get(taskId);
    return task === undefined ? undefined : structuredClone(task);
  }

  start(tool, input) {
    assertToolName(tool);
    const id = randomUUID();
    const task = { id, tool, status: 'running', result: null, error: null };
    if (this.#blocked.has(tool) || !this.#allowed.has(tool) || !this.#tools.has(tool)) {
      return { id, done: Promise.resolve(this.#finish(task, 'blocked', null, 'tool_blocked')) };
    }
    this.#running.set(id, task);
    const done = Promise.resolve().then(() => this.#execute(task, input));
    return { id, done };
  }

  async run(tool, input) {
    return this.start(tool, input).done;
  }

  async #execute(task, input) {
    let value;
    try {
      const handler = this.#tools.get(task.tool);
      const returned = handler(input, { taskId: task.id, tool: task.tool });
      // Only await a promise. A data object may contain an untrusted `then` accessor.
      value = types.isPromise(returned) ? await returned : returned;
    } catch {
      return this.#finish(task, 'failed', null, 'tool_failed');
    }
    let result;
    try {
      result = copyResult(value);
    } catch {
      return this.#finish(task, 'failed', null, 'invalid_result');
    }
    return this.#finish(task, 'completed', result, null);
  }

  #finish(task, status, result, errorCode) {
    this.#running.delete(task.id);
    const record = { ...task, status, result, error: errorCode === null ? null : { code: errorCode } };
    this.#history.set(task.id, record);
    if (this.#history.size > this.#historyLimit) this.#history.delete(this.#history.keys().next().value);
    return structuredClone(record);
  }
}

exports.LocalAgent = LocalAgent;
exports.verifyArtifactReceipt = verifyArtifactReceipt;
