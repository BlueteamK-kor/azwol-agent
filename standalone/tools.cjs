'use strict';

const path = require('node:path');
const { stat } = require('node:fs/promises');

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

async function loadTools(file) {
  const tools = Object.create(null);
  tools['order.total'] = orderTotal;
  if (file === undefined) return tools;

  const filename = path.resolve(file);
  if (path.extname(filename) !== '.cjs') throw new Error('도구 모듈은 로컬 .cjs 파일로 지정하세요.');
  let registry;
  try {
    if (!(await stat(filename)).isFile()) throw new Error();
    registry = require(filename);
  } catch {
    throw new Error('도구 모듈을 열 수 없습니다. 파일 경로와 모듈의 의존성을 확인하세요.');
  }
  if (!registry || ![Object.prototype, null].includes(Object.getPrototypeOf(registry)) ||
      Object.keys(registry).length === 0) {
    throw new Error('도구 모듈은 도구 이름과 실행 함수가 담긴 객체를 내보내야 합니다.');
  }
  for (const name of Object.keys(registry)) {
    if (Object.hasOwn(tools, name)) throw new Error('내장 도구의 이름은 재사용할 수 없습니다.');
    const handler = Object.getOwnPropertyDescriptor(registry, name).value;
    if (typeof handler !== 'function') throw new Error('각 도구에는 실행 함수를 지정하세요.');
    tools[name] = handler;
  }
  return tools;
}

module.exports = { loadTools };
