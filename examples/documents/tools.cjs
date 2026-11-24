'use strict';

const { randomUUID } = require('node:crypto');
const { readFile, rename, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');

const notice = path.join(__dirname, 'notice.txt');

module.exports = {
  async 'document.read'() {
    return { text: await readFile(notice, 'utf8') };
  },

  async 'document.update'(input) {
    if (typeof input?.text !== 'string') throw new TypeError('Expected document text.');

    const temporary = path.join(__dirname, `.notice-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, input.text, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, notice);
    } finally {
      await rm(temporary, { force: true });
    }
    return { updated: true };
  },
};
