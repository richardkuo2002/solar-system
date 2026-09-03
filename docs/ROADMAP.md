# Roadmap / 後續想法

尚未排優先順序，先記錄下來。

## 畫面/體驗加強

- ~~土星環~~ 已完成
- ~~行星/衛星 hover 顯示名稱標籤~~ 已完成
- 小行星帶、彗星（哈雷彗星軌道很戲劇性）
- 更精細的光照（地球日夜 terminator、雲層貼圖）
- 手機觸控支援（目前 free-flight 是 WASD + 滑鼠，手機上完全沒法用）

## 功能面

- 冥王星/矮行星（傾角明顯大於八大行星，加進來可以直接對比「軌道共面」現象）
- 行星資訊面板（點擊行星彈出質量、公轉週期等資料）
- URL 分享狀態（把目前日期、視角模式存進網址參數，方便分享特定畫面）
- 效能：目前 8 行星 + 5 衛星量不大，若加小行星帶要注意 draw call

## 專案基礎建設

- 加 GitHub Actions CI（跑 `npm test`，push 時自動驗證）
- Pages 部署改用 Actions（目前是 legacy build，GitHub 建議遷移到
  workflow-based deployment）
- 加 CONTRIBUTING.md，如果之後考慮開源協作

## 桌面化

- 用 Tauri 或 Electron 包裝成桌面 app（當初規劃就提過，延後的階段；
  若之後想推到市場上再評估）
