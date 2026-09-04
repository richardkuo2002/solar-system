# Solar System 太陽系模擬

[English](README.md) | [繁體中文](README.zh-TW.md)

**線上體驗:https://richardkuo2002.github.io/solar-system/**

一個在瀏覽器中運行、不需任何建置流程的互動式 3D 太陽系模擬。使用真實的軌道力學與行星貼圖，並提供四種不同的觀察視角——由上往下俯瞰、自由飛行、站在行星表面上仰望天空,或是坐在地球上看其他行星逆行漂移。

## 功能

- **8 大行星**(水星至海王星)+ **冥王星** + **7 顆衛星**(月球、木衛一 Io、木衛二 Europa、木衛三 Ganymede、木衛四 Callisto、土衛六 Titan、海衛一 Triton)+ **冥衛一 Charon** + **哈雷彗星** + 靜態小行星帶,位置皆以真實的低精度克卜勒軌道要素計算(Standish 1992 / JPL SSD)。
- 每顆行星都有真實的自轉與自轉傾角(NASA 行星資料表數值),包含金星、天王星真實的逆向自轉。
- **即時位置資料**取自 [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) API,離線或 API 無法連線時會自動、無感切換回本地端的克卜勒方程式計算——渲染迴圈不會因網路請求而卡頓。畫面上的 HUD 會即時顯示目前實際使用的資料來源、參考中心與座標系,詳細模型與已知限制見 [docs/accuracy.md](docs/accuracy.md)(英文)。
- **4 種攝影機模式**:
  - **日心俯瞰(Heliocentric top-down)**——經典的太陽系示意圖視角,可用滑鼠拖曳環繞。
  - **自由飛行(Free-flight)**——WASD + 滑鼠視角,可自由飛到場景中任何位置。
  - **行星表面第一人稱(Surface first-person)**——站在任一行星指定的經緯度上,抬頭仰望天空。
  - **地心視角(Geocentric)**——攝影機固定在地球位置,並保持固定的觀看方向,而地球本身沿著真實軌道移動。火星的逆行現象正是由此產生——這是真實的軌道動力學結果,而非預先寫死的動畫。
- **時間控制**——播放/暫停、調整速度倍率、時光倒流、跳至指定日期。
- 距離與大小皆採用**冪函數曲線壓縮**(並非真實等比例),讓整個太陽系可以同時顯示在畫面上——這是網頁版太陽系視覺化的常見作法。

## 如何執行

不需建置流程、不需安裝任何依賴套件。只要啟動一個本地伺服器即可(直接用 `file://` 開啟無法運作,因為 ES modules 需要實際的 origin):

```bash
python3 -m http.server 8000
# 或: npx serve .
```

接著開啟 `http://localhost:8000`。

## 專案結構

```
src/
├── app.js              # 進入點/組裝各模組、動畫迴圈
├── core/                # 純邏輯,不依賴 DOM 或 THREE——可直接用 Node 測試
│   ├── kepler.js          # 克卜勒方程式求解器、軌道要素轉換為位置
│   ├── orbital-elements.js
│   ├── scale.js           # 距離/大小的壓縮曲線
│   ├── time-controller.js
│   ├── camera-modes.js    # 4 種攝影機模式的狀態機、純函式姿態計算
│   ├── horizons-client.js # JPL Horizons REST API 抓取與解析
│   └── ephemeris.js       # Horizons 與本地計算的切換邏輯、斷路器機制
├── data/                # 行星/衛星軌道要素、貼圖對照表
└── render/               # THREE.js 場景、模型、攝影機、UI(渲染層)
```

`src/core/` 完全不依賴 THREE 或 DOM,因此 `scripts/smoke-test.js` 可以直接在 Node 環境下測試軌道力學、縮放曲線、時間控制器、攝影機姿態計算,以及 Horizons 的解析與 fallback 邏輯:

```bash
npm test
```

## 資料來源

- 軌道要素:JPL Solar System Dynamics 低精度克卜勒軌道要素表(Standish 1992),適用約 1800–2050 年。
- 即時位置:[JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)(不需 API key)。
- 貼圖:詳見下方[資產授權](#資產授權)。

## 目前狀態

v1 版本——桌面應用程式打包(Tauri/Electron)是未來可能的階段,目前尚未著手。

## 資產授權

程式碼採 MIT 授權(見下方[授權](#授權)),但 `assets/textures/` 底下的第三方行星/衛星貼圖各自保留原始授權——MIT 不會改變它們的授權條款。完整的逐檔案清單、來源與 credit,請見:**[ATTRIBUTION.md](ATTRIBUTION.md)**。

行星貼圖主要基於 [Solar System Scope](https://www.solarsystemscope.com/textures/) 的素材,採 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 授權,並依網頁渲染需求做過修改。部分衛星貼圖(木衛一 Io、木衛二 Europa、木衛三 Ganymede、土衛六 Titan、海衛一 Triton、冥衛一 Charon)則來自 Steve Albers / NOAA Science On a Sphere,以 NASA 原始影像整理而成。貼圖由 `scripts/fetch-textures.mjs`(`npm run fetch-textures`)下載,不是手動 commit 上去的——之後隨時可以重跑這個腳本來更新,或補上目前還沒找到穩定來源的天體(清單見 `ATTRIBUTION.md` 的 TODO 區塊)。

## 授權

MIT(僅限程式碼——第三方貼圖授權見上方[資產授權](#資產授權))
