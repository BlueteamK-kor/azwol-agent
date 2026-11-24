'use strict';

const { mkdir, open } = require('node:fs/promises');
const path = require('node:path');

const directory = '.azowl';
const historyFile = path.join(directory, 'task-history.jsonl');

async function appendRecord(line) {
  await mkdir(directory, { recursive: true });
  const file = await open(historyFile, 'a');
  try {
    // Append a complete JSONL record with one write, including for large results.
    const data = Buffer.from(line + '\n');
    const { bytesWritten } = await file.write(data);
    if (bytesWritten !== data.length) throw new Error('Incomplete history record');
  } finally {
    await file.close();
  }
}

async function findRecord(id) {
  let file;
  try {
    file = await open(historyFile, 'r');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let malformed = false;
  try {
    for await (const line of file.readLines({ crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        malformed = true;
        continue;
      }
      if (record?.id === id) return record;
    }
  } finally {
    await file.close();
  }
  if (malformed) throw new Error('Incomplete or invalid history record');
  return null;
}

module.exports = { appendRecord, findRecord };
