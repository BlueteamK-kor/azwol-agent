# AZWOL Agent

AZWOL Agent는 PC나 서버에서 태스크를 받아 로컬 프로파일이 허용한 도구를 실행합니다. 개발자는 자기 도구를 연결하고 태스크 ID로 실행 결과와 권한 판단 이유를 확인할 수 있습니다. Git과 Node.js 20 이상에서 시작하세요.

```sh
git clone https://github.com/BlueteamK-kor/azwol-agent.git
cd azwol-agent
node standalone/agent.cjs run --sample order
```

내장 도구 `order.total`이 [샘플 주문](standalone/samples/order.json)의 합계 `3000`을 반환합니다. 출력의 `id`는 이 태스크의 실행 ID입니다.

## 문서 도구 연결하기

[문서 도구](examples/documents/tools.cjs)는 예제 폴더의 [점검 공지](examples/documents/notice.txt)를 읽고 수정합니다. 아래 두 요청은 같은 도구와 [읽기 전용 프로파일](examples/documents/read-only.json)을 사용합니다. 저장소 루트에서 실행하세요.

```sh
node standalone/agent.cjs run examples/documents/read.json --tools examples/documents/tools.cjs --profile examples/documents/read-only.json
node standalone/agent.cjs run examples/documents/update.json --tools examples/documents/tools.cjs --profile examples/documents/read-only.json
```

| 요청 | 실행 결과 | `policy.reason` |
| --- | --- | --- |
| 공지 조회 (`document.read`) | `completed`. 오후 3시 점검 공지를 반환합니다. | `in_allowlist` |
| 공지를 오후 4시로 수정 (`document.update`) | `blocked` (종료 코드 `1`). 수정 함수를 호출하기 전에 차단합니다. | `explicitly_blocked` |

자기 도구를 붙이려면 CommonJS 파일에서 도구 이름과 함수를 내보내세요. 함수는 태스크의 `input`을 받고 JSON으로 표현할 수 있는 값을 반환합니다. 비동기 함수도 사용할 수 있습니다.

```js
// tools.cjs
module.exports = {
  'report.countRows'(input) {
    return { rows: input.rows.length };
  },
};
```

`--tools ./tools.cjs`로 이 파일을 지정하고 프로파일의 `allowedTools`에 `report.countRows`를 추가하세요. 요청 파일에 `{"tool":"report.countRows","input":{"rows":["A","B"]}}`를 넣으면 결과는 `{"rows":2}`입니다. CLI는 운영자가 지정한 도구 모듈을 현재 사용자의 OS 권한으로 로드하므로 직접 작성하거나 검토한 파일을 사용하세요. 태스크는 등록된 도구 이름을 선택하고 프로파일은 그 이름의 실행 권한을 정합니다.

## 태스크 ID로 판단 이유 확인하기

위 명령 출력의 `id` 값을 복사해 같은 작업 폴더에서 `TASK_ID` 자리에 넣으세요.

```sh
node standalone/agent.cjs show TASK_ID
```

`show`는 `.azowl/task-history.jsonl`에 저장된 해당 태스크의 원래 JSON을 출력합니다. `policy.profile`은 실행 당시 프로파일 파일명이고, `policy.sha256`은 그때 읽은 파일 내용의 SHA-256입니다. `policy.decision`은 `allow` 또는 `deny`입니다. 0.6.59에서 기록한 태스크도 기존 필드로 조회할 수 있습니다.

같은 도구가 두 목록에 모두 있으면 `blockedTools`가 우선합니다. 허용 목록에 없으면 `not_in_allowlist`, 허용했지만 구현이 등록되지 않았으면 `not_registered`가 기록됩니다. 권한을 통과한 도구가 실행 중 오류를 내면 태스크 상태는 `failed`입니다. `run`의 종료 코드는 완료 시 `0`, 차단 또는 실행·기록 실패 시 `1`, 사용법이나 입력 파일 오류 시 `2`입니다.

## 직접 빌드하기

이 CLI는 JavaScript로 작성되어 소스 그대로 실행됩니다. npm으로 테스트한 뒤, 같은 소스를 다른 환경에 설치할 수 있는 로컬 패키지로 묶을 수 있습니다.

```sh
npm test
npm run build
npm install --global ./azwol-agent-0.7.0.tgz
azwol-agent run --sample order
```

빌드 결과는 `azwol-agent-0.7.0.tgz`입니다. 설치하려는 환경에도 Node.js 20 이상이 필요합니다. 테스트와 빌드에는 외부 패키지 다운로드, 계정 또는 API 키가 필요하지 않습니다. Windows 데스크톱 앱의 조직 등록 화면과 중앙 태스크 배정은 기업용 설치판에서 제공합니다.

## 라이선스

이 저장소의 독립 CLI와 내장 로컬 코어는 [Apache License 2.0](LICENSE)으로 배포합니다. 데스크톱에서 가져온 코드의 저작권과 변경 내역은 [데스크톱 원본 고지](licenses/desktop/NOTICE)와 [코어 고지](local-core/NOTICE)에 있습니다.
