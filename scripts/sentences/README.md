# 300문장 음성 → 문장 구간 만들기

영상 음성(한국어 1번 → 영어 2번 반복)을 문장별 구간으로 나눈 과정입니다. 음성 파일과 문장은 저장소에 넣지 않습니다 (비공개 드라이브·시트).

1. `ffmpeg -i 원본.mp3 -ac 1 -ar 16000 full.wav` / `ffmpeg -af silencedetect=noise=-35dB:d=0.35` 로 말소리 구간 → `speech.txt`
2. `chunks.py full.wav speech.txt small chunks.jsonl` — 구간마다 따로 받아쓰기 (faster-whisper)
3. `group.py chunks.jsonl <첫 한국어 시작초> <전체 길이> items.json` — 한국어 구간이 새 문장을 시작
4. `refine.py full.wav items.json medium items_ko.json` — 한국어를 큰 모델로 다시 받아쓰기
5. 영어는 두 번 읽은 것 중 잘리지 않은 쪽을 고르고, 잘못 들린 곳은 손으로 고친 뒤 시트 「300문장」에 입력
6. `verify.py` 로 몇 문장의 구간을 다시 받아써서 확인
