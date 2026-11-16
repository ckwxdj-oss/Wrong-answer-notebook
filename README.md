# 오답노트

수학(그리고 다른 과목) 오답을 빠르게 등록하고, 3일 → 7일 → 14일 → 30일 간격으로 다시 풀며 복습하는 웹앱.
서버 없이 브라우저 안(IndexedDB)에 저장하고, 홈 화면에 추가하면 인터넷 없이도 작동합니다(PWA).

## 파일 구성
| 파일 | 하는 일 |
|---|---|
| `index.html`, `css/style.css` | 화면 |
| `js/app.js` | 화면 이동, 버튼 동작 |
| `js/schedule.js` | 복습 일정 계산 (화면과 분리) |
| `js/stats.js` | 통계, 백업 알림 계산 (화면과 분리) |
| `js/db.js` | IndexedDB 저장 |
| `js/backup.js` | 백업 파일 만들기/불러오기 |
| `js/image.js`, `js/pen.js` | 사진 압축·자르기, S펜 캔버스 |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (오프라인, 홈 화면 추가) |
| `tests/` | 자동 테스트 |

## 내 컴퓨터에서 열어보기
```
python3 -m http.server 8000
```
브라우저에서 http://localhost:8000 접속

## 자동 테스트
Node.js가 설치된 컴퓨터에서:
```
npm test
```

## 앱을 고친 뒤 올릴 때
`sw.js` 맨 위의 `VERSION` 값을 바꿔야(예: `'v1'` → `'v2'`) 이미 설치된 앱에 "새 버전이 준비됐어요" 알림이 뜹니다.

## 백업 파일 형식
`wrongnote-backup-날짜.jsonl` — 첫 줄은 머리말, 그다음 한 줄에 기록 하나씩(사진은 base64 글자). 사진이 많아도 조금씩 읽고 쓸 수 있는 형식입니다.
