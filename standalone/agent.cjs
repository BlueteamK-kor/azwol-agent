#!/usr/bin/env node
// Source edition: load the bundled core, operator-selected tools and local task history.
'use strict';

const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { LocalAgent } = require('../local-core/index.cjs');
const { loadTools } = require('./tools.cjs');
const { appendRecord, findRecord } = require('./history.cjs');

const usage = [
  'AZWOL Agent · 독립 모드',
  '  azwol-agent run <task.json> [--tools <tools.cjs>] [--profile <profile.json>]',
  '  azwol-agent run --sample order [--profile <profile.json>] [--tools <tools.cjs>]',
  '  azwol-agent show <task-id>',
  '작업 결과는 현재 폴더의 .azowl/task-history.jsonl에 한 줄씩 추가됩니다.',
].join('\n');

async function readJson(file, label) {
  let source;
  try {
    source = await readFile(file);
  } catch {
    throw new Error(`${label} 파일을 읽을 수 없습니다. 경로와 읽기 권한을 확인하세요.`);
  }
  try {
    return { value: JSON.parse(source.toString('utf8').replace(/^\uFEFF/, '')), source };
  } catch {
    throw new Error(`${label} 파일의 JSON 형식이 잘못되었습니다.`);
  }
}

function runFiles(args) {
  if (args[0] !== 'run') throw new Error(usage);
  const { values, positionals } = parseArgs({
    args: args.slice(1),
    options: {
      sample: { type: 'string', multiple: true },
      profile: { type: 'string', multiple: true },
      tools: { type: 'string', multiple: true },
    },
    allowPositionals: true,
  });
  for (const option of Object.values(values)) {
    if (option.length !== 1 || !option[0]) throw new Error(usage);
  }
  let taskFile;
  if (values.sample) {
    if (values.sample[0] !== 'order' || positionals.length) throw new Error(usage);
    taskFile = path.join(__dirname, 'samples', 'order.json');
  } else {
    if (positionals.length !== 1 || !positionals[0]) throw new Error(usage);
    taskFile = positionals[0];
  }
  return {
    taskFile, toolsFile: values.tools?.[0],
    profileFile: values.profile?.[0] ?? path.join(__dirname, 'profile.json'),
  };
}

async function showTask(args) {
  const id = args[1];
  if (args.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    console.error('사용법: azwol-agent show <task-id> (실행 결과의 UUID)');
    return 2;
  }
  try {
    const record = await findRecord(id.toLowerCase());
    if (record) {
      console.log(JSON.stringify(record));
      return 0;
    }
    console.error('현재 작업 폴더의 이력에서 태스크 ID를 찾을 수 없습니다.');
  } catch {
    console.error('실행 이력을 읽을 수 없습니다. 파일의 권한과 JSONL 형식을 확인하세요.');
  }
  return 1;
}

async function main(args) {
  if ((args.length === 1 || (args.length === 2 && ['run', 'show'].includes(args[0]))) &&
      ['--help', '-h'].includes(args.at(-1))) {
    console.log(usage);
    return 0;
  }
  if (args[0] === 'show') return showTask(args);
  let files;
  try {
    files = runFiles(args);
  } catch {
    console.error(usage);
    return 2;
  }
  let record;
  try {
    const { value: profile, source } = await readJson(files.profileFile, '프로파일');
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
        Object.keys(profile).some(key => !['allowedTools', 'blockedTools'].includes(key))) {
      throw new Error('프로파일에는 allowedTools와 선택 항목 blockedTools를 사용할 수 있습니다.');
    }
    const { value: task } = await readJson(files.taskFile, '태스크');
    if (!task || typeof task.tool !== 'string' || !Object.hasOwn(task, 'input')) {
      throw new Error('태스크에는 도구 이름 tool과 입력값 input이 필요합니다.');
    }
    const agent = new LocalAgent({
      allowedTools: profile.allowedTools,
      blockedTools: profile.blockedTools,
      tools: await loadTools(files.toolsFile),
    });
    const { done, policy } = agent.start(task.tool, task.input);
    record = {
      ...(await done),
      policy: {
        profile: path.basename(files.profileFile),
        sha256: createHash('sha256').update(source).digest('hex'),
        ...policy,
      },
    };
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const line = JSON.stringify(record);
  try {
    await appendRecord(line);
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
