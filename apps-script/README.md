# 영어 복습 앱 – 미국식 남자 목소리

## 적용 (Apps Script 편집기)
1. `StudyPage.html` → 이 저장소의 `StudyPage.html` 내용으로 **전체 교체**
2. `+` → 스크립트 → 이름 `Voice` → `Voice.gs` 내용 붙여넣기
3. 배포 → 배포 관리 → 수정(연필) → 버전 **새 버전** → 배포

여기까지만 해도: 기기에 남자 목소리가 없으면 오류 대신 **기본 목소리를 낮은 톤으로** 읽습니다.

## 모든 기기에서 진짜 미국 남자 목소리 (Google Cloud TTS)
1. https://console.cloud.google.com → 프로젝트 만들기 → 결제 계정 연결 (월 100만 글자 무료)
2. "Cloud Text-to-Speech API" 검색 → **사용 설정**
3. API 및 서비스 → 사용자 인증 정보 → **API 키 만들기** → 키 제한: Cloud Text-to-Speech API
4. Apps Script 편집기 → 프로젝트 설정(톱니) → 스크립트 속성 → `TTS_API_KEY` = 키 값
5. 편집기에서 `mobileStudyTtsEnabled` 한 번 실행 → 권한 승인 → 새 버전 배포
6. 앱의 **목소리** 칸이 `미국식 남성 · Google 고품질 (자동)` 인지 확인

| 발음 | Google 목소리 |
|---|---|
| 미국식 | en-US-Neural2-D (남성) |
| 영국식 | en-GB-Neural2-B (남성) |
