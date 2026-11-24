# AZWOL Agent

AZWOL Agent 독립 실행판은 PC나 서버에서 로컬 프로파일을 읽어 태스크 한 건을 실행하고 결과를 기록합니다. 0.6.59의 내장 도구 `order.total`로 권한 확인, 도구 실행, 결과 기록까지 해볼 수 있습니다. Git과 Node.js 20 이상이 있으면 다음 명령으로 소스를 받아 실행할 수 있습니다.

```sh
git clone https://github.com/BlueteamK-kor/azwol-agent.git
cd azwol-agent
node standalone/agent.cjs run --sample order
```

샘플 주문의 합계는 `3000`입니다. 출력 JSON에는 실행마다 새로 발급된 `id`, 도구 이름, 상태, 결과가 들어갑니다. 같은 JSON이 현재 작업 폴더의 `.azowl/task-history.jsonl`에 한 줄씩 추가됩니다.

## 태스크와 권한

[샘플 주문](standalone/samples/order.json)의 단가나 수량을 바꾸고 [로컬 프로파일](standalone/profile.json)을 지정해 실행하세요.

```sh
node standalone/agent.cjs run standalone/samples/order.json --profile standalone/profile.json
```

프로파일에 `{"allowedTools":[]}`를 넣으면 같은 주문이 `blocked`로 기록됩니다. 종료 코드는 완료 시 `0`, 차단 또는 실행·기록 실패 시 `1`, 입력 파일이나 사용법 오류 시 `2`입니다.

## 직접 빌드하기

이 CLI는 JavaScript로 작성되어 소스 그대로 실행됩니다. npm으로 테스트한 뒤, 같은 소스를 다른 환경에 설치할 수 있는 로컬 패키지로 묶을 수 있습니다.

```sh
npm test
npm run build
npm install --global ./azwol-agent-0.6.59.tgz
azwol-agent run --sample order
```

빌드 결과는 `azwol-agent-0.6.59.tgz`입니다. 설치하려는 환경에도 Node.js 20 이상이 필요합니다. 테스트와 빌드에는 외부 패키지 다운로드, 계정 또는 API 키가 필요하지 않습니다. Windows 데스크톱 앱의 조직 등록 화면과 중앙 태스크 배정은 기업용 설치판에서 제공합니다.

## 라이선스

이 저장소의 독립 CLI와 내장 로컬 코어는 [Apache License 2.0](LICENSE)으로 배포합니다. 데스크톱에서 가져온 코드의 저작권과 변경 내역은 [데스크톱 원본 고지](licenses/desktop/NOTICE)와 [코어 고지](local-core/NOTICE)에 있습니다.
