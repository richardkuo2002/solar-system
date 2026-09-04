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

## 天文事件工具箱(Event Toolkit,v0.5)

畫面右側(星曆 HUD 下方)的「Event Toolkit」面板是本專案的天文現象分析工具——用下拉選單挑選事件類型,共用同一組結果/圖表版面呈現。

- **逆行(火星)**(v0.4)——在每個取樣點計算火星的地心黃經(`λ = atan2(Δy, Δx)`,取自日心火星-地球 AU 差向量),把角度序列展開(unwrap)以避免 0°/360° 邊界誤判,再用中心差分求其變化率,最後透過粗掃描 + 二分搜尋精修出兩個變化率為零的 stationary point——絕不會直接把粗取樣點當成答案回傳。視覺呈現:主場景中的地球-火星視線連線(建議切換到日心俯瞰或自由飛行視角觀看)、對照參考網格繪出的火星視在路徑,以及標示兩個 stationary point 與逆行區間的 λ(t) 時間軸圖。
- **衝 / 合**(火星、木星、土星)——同一套粗掃描 + 二分搜尋求解器,改餵入日心距角(太陽-地球-行星夾角)的變化率:由正轉負的翻轉是「衝」,由負轉正是「合」。
- **最大距角**(水星、金星)——同一套求解器,改餵入「有號距角」(正=太陽以東/黃昏可見,負=太陽以西/黎明可見)的變化率;找的是極值而非變化率的零點。
- **下合 / 上合**——直接把有號距角本身的數值(而非變化率)餵入求解器找零點;每個零點再依「地球到目標星球的距離」與「地球到太陽的距離」比較,分類為下合(較近,在地球與太陽之間)或上合(較遠,在太陽另一側)。
- **相位角 / 被照亮比例**(月球、水星、金星、火星)——單一時間點的計算,不需要求解器:相位角 α(太陽-目標-觀測者夾角)與被照亮比例 `k = (1 + cos(α)) / 2`。月球的相位計算使用另一組獨立的圓軌道近似,與主場景 3D 月球動畫的模型不同——原因與細節見 [docs/accuracy.md](docs/accuracy.md#the-moons-second-independent-circular-orbit-approximation)(英文),兩者在同一日期可能呈現不同軌道角度,且都未校準到月球的真實相位。
- **匯出**——任何分析結果都可透過面板的匯出按鈕存成 JSON 或 CSV,內含完整可重現的中繼資料(事件類型、目標、觀測者、參考座標系/中心/來源、輸入參數、求解方法與容許誤差);圖表用的密集取樣資料則刻意不包含在匯出內容中。
- **已知限制**——僅為幾何角度,未做光行時修正;視在路徑圖畫的是原始 AU 座標,不是投影到天球的 RA/Dec 視圖;超出 Standish 表約 1800–2050 年有效範圍的結果會愈趨近似;不論下拉選單選哪個資料來源,每種事件的密集取樣掃描內部一律使用克卜勒傳播計算(原因見 [docs/accuracy.md](docs/accuracy.md),英文)。

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
