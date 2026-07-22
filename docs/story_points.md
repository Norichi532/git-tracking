# Story Points Metrics

Dashboard dung story points de danh gia tai sprint va rui ro tien do. Khong nen dung story points don doc de ket luan hieu suat ca nhan.

## Chi so tren dashboard

| Chi so | Y nghia |
| --- | --- |
| `Assigned points` | Tong story points cua task duoc giao cho member trong sprint |
| `Done points` | Tong story points cua task da hoan thanh |
| `Remaining points` | Story points con lai, tinh bang `assigned - done` |
| `Weighted progress` | Tien do co trong so theo story point |
| `Missing story point tasks` | So task chua co story point |

## Cong thuc weighted progress

```txt
sum(storyPoints * progressPercent) / sum(storyPoints)
```

Neu task khong co story point, task do khong duoc dua vao weighted progress. Dashboard van hien warning de PM/BA bo sung estimate.

## Canh bao lien quan

| Code | Khi nao xuat hien |
| --- | --- |
| `NO_STORY_POINTS` | Task chua co story point |
| `LARGE_TASK_SHOULD_SPLIT` | Task tu 13 points tro len |
| `HIGH_POINT_NOT_STARTED` | Task tu 8 points tro len nhung chua bat dau |
| `HIGH_POINT_NO_GITHUB_ACTIVITY` | Task tu 8 points tro len dang chay nhung chua co PR lien ket |

## Cach dien giai

Story points nen duoc dung de phat hien:

- Member nao dang bi gan qua tai trong sprint.
- Task lon nao can tach nho.
- Sprint co nguy co tre vi remaining points con cao.
- Estimate co lech voi dev time, cycle time hoac logged work hay khong.

Khong nen dung story points nhu don vi chuyen doi truc tiep sang gio lam hoac nang suat ca nhan.
