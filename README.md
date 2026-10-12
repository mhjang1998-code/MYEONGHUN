# 영어 복습 앱

| 폴더 | 내용 |
|---|---|
| `docs/` | GitHub Pages 앱 (https://mhjang1998-code.github.io/MYEONGHUN/) |
| `docs/audio/` | 자동으로 만든 발음 MP3 (파일 이름 = 목소리+단어의 해시) |
| `api/` | 새 Apps Script 프로젝트에 넣을 코드 (시트 읽기·쓰기 API) |
| `scripts/make_audio.py` | Kokoro로 발음 MP3 생성 |
| `.github/workflows/study-site.yml` | 10분마다 새 단어 음성 생성 + Pages 배포 |
| `apps-script/` | 기존 Apps Script 앱 화면 (기기 음성 버전, 계속 사용 가능) |

## 구조
```
구글 시트 ── api/ (Apps Script, 연결 키 필요) ── docs/ 앱 (PC·아이폰·아이패드)
                 └── GitHub 자동화: 새 단어 → Kokoro 음성 → docs/audio
```
- 목소리: 미국 Adam(기본)·Fenrir·Puck·Liam, 영국 Daniel (Kokoro, 오픈 소스, GitHub 서버 안에서 생성). 앱의 목소리 칸에서 선택
- 파일이 아직 없는 단어는 기기 남성 음성으로 임시 재생

## GitHub 설정 (처음 1회)
- Settings → Pages → Source: **GitHub Actions**
- Settings → Secrets → Actions: `STUDY_API_URL`, `STUDY_API_KEY`

## 테스트
```
npm install && npm test
```
