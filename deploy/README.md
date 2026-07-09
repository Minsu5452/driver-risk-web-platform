# DriverRisk Platform — 배포 가이드

외부망 분리 환경에 배포하기 위한 포터블 zip 패키지 생성 및 설치 절차입니다.

---

## 1. 배포 zip 생성 (개발자, Mac에서 실행)

`deploy/build-package.sh`가 다음을 한 번에 수행합니다.

1. 이전 검증된 zip의 `python/`, `jre/`, `nginx/`, `wheels/` 번들을 템플릿으로 사용
2. `frontend` 를 `npm run build`로 새로 빌드 → `frontend/dist/`
3. `backend` 를 `mvn package`로 새로 빌드 → `driverrisk-platform.jar`
4. `ai-engine/src/` 최신 소스 복사, `requirements.txt`는 `pyproject.toml`에서 재생성
5. `deploy/scripts/` 의 install/start/stop.bat 을 루트에 복사 (BOM 제거, CRLF 정리)
6. `deploy/nginx/nginx.conf` 를 `nginx/conf/nginx.conf`로 교체
7. 새 zip 생성: `dist/DriverRisk-Platform-AutoStart.zip`

```bash
./deploy/build-package.sh /path/to/template.zip [/path/to/output.zip]
```

> 템플릿 zip(검증된 이전 배포 번들)은 첫 번째 인자로 지정합니다.

---

## 2. 보안 검사 및 전달

생성된 `dist/DriverRisk-Platform-AutoStart.zip` (약 400MB) 을 보안 검사를 거쳐 운영 PC로 전달합니다.

---

## 3. 설치 (운영 Windows PC, 관리자 권한)

### 3-1. 압축 해제

zip 을 **영문/공백 없는 경로**에 해제합니다. 예) `D:\temp\DriverRisk-Platform-AutoStart\`

> **주의**: `C:\Users\홍길동\바탕 화면\` 같은 한글/공백 경로는 절대 사용하지 말 것.

### 3-2. install.bat 실행

`DriverRisk-Platform-AutoStart\install.bat` 을 **마우스 우클릭 → 관리자 권한으로 실행**.

`install.bat` 이 자동으로 수행하는 작업:

| 단계 | 내용 |
|---|---|
| A | 기존 `RISK_Platform` 자동시작 태스크 해제 |
| B | 실행 중인 플랫폼 서비스 종료 (경로 필터 + 포트 3000/8000/8080 이중 확인) |
| C | 기존 설치 확인 — 남아 있으면 수동 삭제를 안내하고 중단 |
| D | 새 파일 복사 |
| E | Python embeddable 설정 (`python310._pth` 수정) |
| F | pip 오프라인 설치 (`wheels/`) |
| G | AI Engine 의존성 오프라인 설치 |
| H | 방화벽 규칙 / 바탕화면 바로가기 / 자동시작 태스크 등록 |
| I | `start.bat` 호출 → 서비스 기동 |

설치 완료 후 브라우저가 `http://localhost:3000` 으로 자동 열립니다.

---

## 4. 관리자 계정

| 구분 | 기본값 |
|---|---|
| 사용자명 | `admin` |
| 비밀번호 | `change-this!` |

`start.bat` 이 환경변수로 주입하므로 설정 파일을 따로 수정할 필요가 없습니다. 비밀번호는 배포 전에 `install.bat`과 `start.bat`의 플레이스홀더 값을 바꿔서 씁니다.

---

## 5. 일상 운영

| 작업 | 방법 |
|---|---|
| 시작 | 바탕화면 **DriverRisk Start** 더블클릭 (또는 `C:\DriverRisk-Platform\start.bat`) |
| 종료 | 바탕화면 **DriverRisk Stop** 더블클릭 (또는 `C:\DriverRisk-Platform\stop.bat`) |
| 접속 | 바탕화면 **DriverRisk Platform** 더블클릭 (또는 `http://localhost:3000`) |
| 자동 시작 | Windows 로그인 시 `schtasks` 가 `start.bat` 을 자동 실행 |

---

## 6. 데이터 / 로그 위치

```
C:\DriverRisk-Platform\
├── ai-engine\data\       AI Engine DB (검사 기록 등)
├── ai-engine\artifacts\  학습된 모델 (versions/)
└── logs\
    ├── ai-engine.log         / ai-engine-error.log
    ├── backend.log           / backend-error.log
    ├── nginx-access.log      / nginx-error.log
    ├── install-pip.log       / install-packages.log
```

재배포 시 기존 `C:\DriverRisk-Platform` 은 [INSTALL.md](INSTALL.md) 7장 절차대로 수동으로 삭제합니다. DB와 모델도 함께 초기화되므로 매 배포 후 재학습을 전제로 합니다.

---

## 7. 문제 해결

### "관리자 권한으로 실행하세요" 에러
→ install.bat 우클릭 → **관리자 권한으로 실행**.

### "Cannot remove old installation" 에러
→ `C:\DriverRisk-Platform` 을 연 상태인 탐색기/에디터/터미널을 모두 닫은 뒤 재시도.

### "pip install failed" 에러
→ `C:\DriverRisk-Platform\logs\install-pip.log` 확인. 대부분 wheels 누락 → 템플릿 zip 재수령 필요.

### 관리자 로그인 실패
→ `start.bat` 을 해당 계정 환경이 아닌 다른 경로에서 실행했거나, 이전 설치의 start.bat이 실행 중일 수 있음. `stop.bat` 후 `start.bat` 재실행.

### 포트 충돌 (3000/8000/8080)
→ `install.bat` 이 기존 점유자를 종료하지만, 안 될 경우 수동으로:
```
netstat -ano | findstr :3000
taskkill /PID <번호> /F
```

### 한글 깨짐
- 업로드 파일명 한글: 정상 처리됨 (FastAPI UTF-8)
- 서버 응답 한글: `application.properties` UTF-8 강제 + JVM `-Dfile.encoding=UTF-8` 적용됨
- 콘솔 출력 한글: `chcp 65001` + `PYTHONUTF8=1` 적용됨
- 폴더 경로에 한글 포함 시: **설치 경로를 반드시 `C:\DriverRisk-Platform` 으로만 유지**

---

## 8. 재배포 (업데이트)

1. 개발자: `./deploy/build-package.sh` → 새 `DriverRisk-Platform-AutoStart.zip`
2. 보안 검사 → 운영 PC 전달
3. 운영자: 압축 해제 → **install.bat 관리자 권한 실행**
4. `install.bat` 이 기존 설치를 자동으로 정리하고 새 버전으로 덮어씁니다.
