#!/usr/bin/env node
// Source edition: load the bundled local core directly.
'use strict';

const { readFile, mkdir, appendFile } = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { LocalAgent } = require('../local-core/index.cjs');

const usage = [
  'AZWOL Agent · 독립 모드',
  '  azwol-agent run <task.json> [--profile <profile.json>]',
  '  azwol-agent run --sample order [--profile <profile.json>]',
  '작업 결과는 현재 폴더의 .azowl/task-history.jsonl에 한 줄씩 추가됩니다.',
].join('\n');

function orderTotal(input) {
  if (!Array.isArray(input?.items) || input.items.length === 0) throw new TypeError('items');
  let total = 0;
  for (const item of input.items) {
    if (!Number.isSafeInteger(item?.quantity) || item.quantity < 1 ||
        !Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0) throw new TypeError('order item');
    total += item.quantity * item.unitPrice;
    if (!Number.isSafeInteger(total)) throw new RangeError('total');
  }
  return total;
}

async function readJson(file, label) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    throw new Error(`${label} 파일을 읽을 수 없습니다. 경로와 읽기 권한을 확인하세요.`);
  }
  try {
    return JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`${label} 파일의 JSON 형식이 잘못되었습니다.`);
  }
}

function runFiles(args) {
  if (args[0] !== 'run') throw new Error(usage);
  const { values, positionals } = parseArgs({
    args: args.slice(1),
    options: { sample: { type: 'string', multiple: true }, profile: { type: 'string', multiple: true } },
    allowPositionals: true,
  });
  if (values.profile && (values.profile.length !== 1 || !values.profile[0])) throw new Error(usage);
  let taskFile;
  if (values.sample) {
    if (values.sample.length !== 1 || values.sample[0] !== 'order' || positionals.length) throw new Error(usage);
    taskFile = path.join(__dirname, 'samples', 'order.json');
  } else {
    if (positionals.length !== 1 || !positionals[0]) throw new Error(usage);
    taskFile = positionals[0];
  }
  return { taskFile, profileFile: values.profile?.[0] ?? path.join(__dirname, 'profile.json') };
}

async function main(args) {
  if ((args.length === 1 || (args.length === 2 && args[0] === 'run')) &&
      ['--help', '-h'].includes(args.at(-1))) {
    console.log(usage);
    return 0;
  }
  let files;
  try {
    files = runFiles(args);
  } catch {
    console.error(usage);
    return 2;
  }
  let record;
  try {
    const profile = await readJson(files.profileFile, '프로파일');
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
        Object.keys(profile).some(key => !['allowedTools', 'blockedTools'].includes(key))) {
      throw new Error('프로파일에는 allowedTools와 선택 항목 blockedTools를 사용할 수 있습니다.');
    }
    const agent = new LocalAgent({
      allowedTools: profile.allowedTools,
      blockedTools: profile.blockedTools,
      tools: { 'order.total': orderTotal },
    });
    const task = await readJson(files.taskFile, '태스크');
    if (!task || typeof task.tool !== 'string' || !Object.hasOwn(task, 'input')) {
      throw new Error('태스크에는 도구 이름 tool과 입력값 input이 필요합니다.');
    }
    record = await agent.run(task.tool, task.input);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const line = JSON.stringify(record);
  try {
    await mkdir('.azowl', { recursive: true });
    await appendFile(path.join('.azowl', 'task-history.jsonl'), line + '\n', 'utf8');
  } catch {
    console.error('작업 이력을 저장할 수 없습니다. 현재 폴더의 쓰기 권한을 확인하세요.');
    return 1;
  }
  console.log(line);
  if (record.status === 'failed' && record.tool === 'order.total') {
    console.error('order.total에는 주문 항목이 필요합니다. 단가는 0 이상, 수량은 1 이상이며 금액과 수량은 안전한 정수 범위여야 합니다.');
  }
  return record.status === 'completed' ? 0 : 1;
}

module.exports = { main };
if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
