# Codex Theme

macOS Codex 데스크톱 앱에 사용자 사진 배경과 커스텀 UI 효과를 적용하는 비공식 로컬 실행기입니다. 원본 `/Applications/ChatGPT.app`과 `app.asar`는 수정하지 않습니다.

개인 사진은 저장소에 포함하지 않습니다. 실행 전에 사용할 JPEG 파일을 프로젝트 루트에 `image.jpg`라는 이름으로 복사하십시오.

## 실행

Dock의 **Codex** 아이콘이나 `Codex.app`을 클릭하면 터미널 없이 실행됩니다.

터미널에서 상태 메시지를 보며 실행하려면 `Launch Codex Theme.command`를 더블클릭합니다. 처음 열리지 않으면 Finder에서 파일을 우클릭하고 **열기**를 선택합니다.

`.command` 방식에서는 실행기가 열어 둔 터미널을 닫으면 이 전용 Codex 인스턴스도 함께 종료됩니다. Dock 앱 방식에서는 Codex 창을 닫으면 백그라운드 실행기도 종료됩니다.

`Codex.app` 실행 래퍼는 Apple Silicon용 ad-hoc 빌드입니다. 다른 Mac에서 처음 실행할 때는 Finder에서 앱을 우클릭한 뒤 **열기**를 선택해야 할 수 있습니다.

## 동작 방식

- Chromium 원격 디버깅 TCP 포트 대신 부모·자식 프로세스 사이의 전용 파이프를 사용합니다.
- 별도 프로필은 `~/Library/Application Support/Codex Theme`에 저장됩니다.
- macOS의 Desktop 폴더 개인정보 보호 대기를 피하도록 사진 사본을 프로젝트 안에서 읽습니다.
- JPEG를 데이터 URL로 읽어 채팅 영역에는 60% 검정 오버레이를 적용합니다.
- 사이드바의 기본 재질과 동작은 유지하고, 프로필 바로 위 바닥에 전체 폭의 컴팩트한 사용량 스트립만 추가합니다.
- 요금제 메뉴의 `Upgrade for more usage` 안내 행을 숨깁니다.
- 프로필 푸터는 수정하지 않습니다. 사용량은 앱 내부의 `/wham/usage` 요청 통로에서 직접 읽어 일본어 `남은 % · 재설정 날짜`와 얇은 진행 막대로 표시하며 1분마다 갱신합니다.
- 현재 채팅이 응답 생성 중이면 입력창의 실제 둥근 사각 둘레를 기준으로 색과 위치가 한 덩어리처럼 시계방향 이동하며, 응답이 끝나면 즉시 순정 입력창으로 돌아갑니다.
- 고정된 `VPN`, `Proxmox`, `Homelab`, `Oracle_seoul` 연결에는 SSH 인증 없이 포트 연결 시간만 15초 간격으로 측정해 `N ms`를 표시합니다. 응답하지 않는 연결에는 숫자를 표시하지 않습니다.
- 마지막 사용량은 전용 프로필에 최대 6시간 동안 보관해 다음 실행 시 즉시 표시하고, `/wham/usage` 응답이 갱신되면 반영합니다.
- 새 창이나 새로고침에도 다시 적용합니다.

## 요구 사항

- macOS 12 이상
- Apple Silicon Mac
- `/Applications/ChatGPT.app` 또는 `/Applications/Codex.app`
- Node.js

## 다른 사진 사용

```sh
node codex-theme.mjs --image /absolute/path/to/photo.jpg
```

이 기능은 공식 Codex 설정이 아니므로 앱 UI 구조가 크게 바뀌면 실행기 업데이트가 필요할 수 있습니다.
