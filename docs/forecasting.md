# Task Forecasting

Dashboard du bao task theo 2 tang:

1. Rule-based forecast: luon chay, minh bach, khong can AI key.
2. AI explanation: optional, chi bat khi co cau hinh env.

## Rule-based forecast

Moi task co object:

```txt
forecast.risk
forecast.confidence
forecast.label
forecast.reasons[]
forecast.suggestedActions[]
forecast.factors
```

Risk gom:

| Risk | Label | Y nghia |
| --- | --- | --- |
| `on_track` | Kịp tiến độ | Chua thay tin hieu rui ro dang ke |
| `at_risk` | Có rủi ro | Can PM/Scrum Master theo doi |
| `off_track` | Khó kịp | Co kha nang khong kip sprint neu khong can thiep |
| `unknown` | Chưa đủ dữ liệu | Thieu ngay sprint hoac task khong con trong luong delivery |

Rule dang xem cac tin hieu:

- Sprint da het han nhung task chua done.
- Sprint da qua 50-75% nhung task chua bat dau.
- Progress thap so voi thoi gian sprint da troi qua.
- Task tu 8 story points tro len nhung chua co PR.
- Blocked time cao.
- Chua logged work sau khi da bat dau dev.
- Unaccounted time cao.

## AI explanation optional

AI khong thay the rule forecast. Backend gui payload da rut gon cho AI de viet ly do va action de hieu hon.

Cau hinh Gemini:

```env
AI_FORECAST_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
AI_FORECAST_TASK_LIMIT=25
AI_FORECAST_INCLUDE_UNKNOWN=false
```

Cau hinh OpenAI:

```env
AI_FORECAST_ENABLED=true
AI_FORECAST_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6
AI_FORECAST_TASK_LIMIT=25
AI_FORECAST_INCLUDE_UNKNOWN=false
```

Neu thieu key hoac API loi, dashboard van dung rule-based forecast va gan `forecast.aiUnavailable=true`.

Mac dinh API khong goi AI. Bat AI theo tung request khi can explanation/action:

```txt
GET /api/progress?...&ai=true
```

Frontend co toggle `AI forecast`; mac dinh tat. Khi tat, dashboard chi dung rule-based forecast.

Mac dinh AI chi duoc goi cho task `at_risk`, `off_track`, hoac co warning cap `warning`. Task `unknown` khong goi AI tru khi bat:

```env
AI_FORECAST_INCLUDE_UNKNOWN=true
```

## Nguyen tac su dung

Forecast la tin hieu dieu hanh sprint, khong phai ket luan hieu suat ca nhan. PM nen dung forecast de hoi dung cau hoi:

- Task nao can unblock?
- Task nao can tach scope?
- Task nao can PR/review som?
- Task nao can carry-over sang sprint sau?
