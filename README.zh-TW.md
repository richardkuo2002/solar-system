# Solar System 太陽系模擬

[English](README.md) | [繁體中文](README.zh-TW.md)

**線上體驗:https://richardkuo2002.github.io/solar-system/**

一個在瀏覽器中運行、不需任何建置流程的互動式 3D 太陽系模擬。使用真實的軌道力學與行星貼圖，並提供四種不同的觀察視角——由上往下俯瞰、自由飛行、站在行星表面上仰望天空,或是坐在地球上看其他行星逆行漂移。

## 功能

- **8 大行星**(水星至海王星)+ **冥王星** + **7 顆衛星**(月球、木衛一 Io、木衛二 Europa、木衛三 Ganymede、木衛四 Callisto、土衛六 Titan、海衛一 Triton)+ **冥衛一 Charon** + **哈雷彗星** + 靜態小行星帶,位置皆以真實的低精度克卜勒軌道要素計算(Standish 1992 / JPL SSD)。
- 每顆行星都有真實的自轉與自轉傾角(NASA 行星資料表數值),包含金星、天王星真實的逆向自轉。
- **真實星空背景**(v1.2)——夜空改用真實的星表資料(以 Hipparcos 星表編號、約 5,000 顆亮度 6.5 等以內的恆星,依真實赤經/赤緯定位),並疊加 88 個傳統星座連線,不再是隨機亂數產生的假星空。資料來源為 [d3-celestial](https://github.com/ofrohn/d3-celestial)(BSD-3-Clause),詳見 [ATTRIBUTION.md](ATTRIBUTION.md)。
- **即時位置資料**取自 [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) API,離線或 API 無法連線時會自動、無感切換回本地端的克卜勒方程式計算——渲染迴圈不會因網路請求而卡頓。畫面上的 HUD 會即時顯示目前實際使用的資料來源、參考中心與座標系,詳細模型與已知限制見 [docs/accuracy.md](docs/accuracy.md)(英文)。
- **4 種攝影機模式**——每種模式都能用 WASD,但只有自由飛行是真正的自由移動,其他三種模式的 WASD 是切換該模式自己的「起始點」:
  - **日心俯瞰(Heliocentric top-down)**——經典的太陽系示意圖視角,可用滑鼠拖曳環繞;WASD 平移環繞的中心點。
  - **自由飛行(Free-flight)**——WASD + 滑鼠視角,可自由飛到場景中任何位置。
  - **行星表面第一人稱(Surface first-person)**——站在任一行星指定的經緯度上,抬頭仰望天空;WASD 走動改變經緯度(W/S=南北,A/D=東西)。
  - **地心視角(Geocentric)**——攝影機固定在地球位置,並保持固定的觀看方向,而地球本身沿著真實軌道移動。火星的逆行現象正是由此產生——這是真實的軌道動力學結果,而非預先寫死的動畫。WASD 切換目前追蹤的行星,並重新對準新目標。
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
npm run lint   # ESLint,recommended ruleset(v0.9)
```

這兩個指令會在每次 push/PR 時透過 GitHub Actions 自動執行
(`.github/workflows/ci.yml`);另外有一個 workflow
(`.github/workflows/deploy.yml`)在 `main` 分支跑完同樣的 lint+test 之後,
把網站部署到 GitHub Pages。

## 天文事件工具箱(Event Toolkit,v0.5)

畫面右側(星曆 HUD 下方)的「Event Toolkit」面板是本專案的天文現象分析工具——用下拉選單挑選事件類型,共用同一組結果/圖表版面呈現。

- **逆行(火星)**(v0.4)——在每個取樣點計算火星的地心黃經(`λ = atan2(Δy, Δx)`,取自日心火星-地球 AU 差向量),把角度序列展開(unwrap)以避免 0°/360° 邊界誤判,再用中心差分求其變化率,最後透過粗掃描 + 二分搜尋精修出兩個變化率為零的 stationary point——絕不會直接把粗取樣點當成答案回傳。視覺呈現:主場景中的地球-火星視線連線(建議切換到日心俯瞰或自由飛行視角觀看)、對照參考網格繪出的火星視在路徑,以及標示兩個 stationary point 與逆行區間的 λ(t) 時間軸圖。
- **衝 / 合**(火星、木星、土星)——同一套粗掃描 + 二分搜尋求解器,改餵入日心距角(太陽-地球-行星夾角)的變化率:由正轉負的翻轉是「衝」,由負轉正是「合」。
- **最大距角**(水星、金星)——同一套求解器,改餵入「有號距角」(正=太陽以東/黃昏可見,負=太陽以西/黎明可見)的變化率;找的是極值而非變化率的零點。
- **下合 / 上合**——直接把有號距角本身的數值(而非變化率)餵入求解器找零點;每個零點再依「地球到目標星球的距離」與「地球到太陽的距離」比較,分類為下合(較近,在地球與太陽之間)或上合(較遠,在太陽另一側)。
- **相位角 / 被照亮比例**(月球、水星、金星、火星)——單一時間點的計算,不需要求解器:相位角 α(太陽-目標-觀測者夾角)與被照亮比例 `k = (1 + cos(α)) / 2`。月球的相位計算使用 Meeus 月球理論的位置,與主場景 3D 月球動畫(仍使用較簡化的圓軌道近似)是分開的——原因與細節見 [docs/accuracy.md](docs/accuracy.md#the-moons-analysis-position-v11-meeus-lunar-theory)(英文),兩者在同一日期可能呈現些微不同的軌道角度。
- **月食 / 日食**(v1.1)——建立在上述 Meeus 月球理論之上的真實食象幾何計算:月食依月球相對地球本影軸的偏移量與該距離下本影/半影錐半徑,分類為無/半影/偏食/全食;日食則針對**特定觀測地點**(經緯度/海拔)分類為無/偏食/環食/全食,計算方式與 Observer Mode 相同,採用地心視差修正。已用兩個真實歷史事件對照測試(2022-11-08 月全食、2024-04-08 日全食)——確切的幾何簡化(球形天體、未計入大氣散射放大效應、只回報食分與單一極大時刻,而非完整四/五接觸點時刻表)見 [docs/accuracy.md](docs/accuracy.md#eclipses-v11)(英文)。
- **匯出**——任何分析結果都可透過面板的匯出按鈕存成 JSON 或 CSV,內含完整可重現的中繼資料(事件類型、目標、觀測者、參考座標系/中心/來源、輸入參數、求解方法與容許誤差);圖表用的密集取樣資料則刻意不包含在匯出內容中。
- **已知限制**——僅為幾何角度,未做光行時修正;視在路徑圖畫的是原始 AU 座標,不是投影到天球的 RA/Dec 視圖;超出 Standish 表約 1800–2050 年有效範圍的結果會愈趨近似;不論下拉選單選哪個資料來源,每種事件的密集取樣掃描內部一律使用克卜勒傳播計算(原因見 [docs/accuracy.md](docs/accuracy.md),英文)。

## 觀測者模式(Observer Mode,v0.6)

畫面左側(地表控制列下方)的「Observer Mode」面板新增「地表某一點觀測」視角——不再只是地心觀測。輸入觀測者的經緯度/海拔(預設為高雄 22.6273°N、120.3014°E、海拔 0m,可自由修改)與觀測時間,選擇目標(太陽、月球或 8 大行星之一),按下 Observe:

- 該時刻的**赤經/赤緯(RA/Dec)**與**地平座標(Alt/Az)**,並標示地平線上下。
- 該 UTC 日期的**升起/中天/落下時間**,以及含地平線的高度-時間曲線圖。若目標當天恆顯(不落下)或恆隱(不升起),會如實標示,不會捏造升落時刻。
- **地心視差(拓撲中心)修正**——從既有的地心位置出發,扣除觀測者自身的位置(由經緯度/海拔與恆星時推算)。使用**固定**黃赤交角(未考慮歲差/章動)、**球形地球**(未考慮扁率)、**未做**光行差與大氣折射修正——每一項近似都詳列於 [docs/accuracy.md](docs/accuracy.md#observer-mode-v06)(英文)。

## 行星資訊面板(Planet Info Panel,v0.7)

點擊任一天體(行星、衛星、彗星、矮行星或太陽),左下角面板會顯示既有資料中該天體的物理/軌道特徵——純資料展示,沒有新增任何天文計算:

- **質量**——只有太陽和 8 大行星有(NASA 官方數值);衛星/彗星/矮行星沒有可信數字,不補假資料,直接不顯示這一欄。
- **自轉週期/自轉軸傾角**——只有太陽和行星有。
- **公轉週期**——行星/彗星/矮行星是用克卜勒第三定律(`T ≈ a^1.5`,跟 `data/comets.js` 推算哈雷彗星週期用的是同一招)從軌道要素推算出來的,因為這些資料本身沒有直接存週期;衛星/冥衛一則是直接用它們既有的 `periodDays` 真實數值。面板會標明是哪一種來源。
- **軌道要素**(半長軸、離心率、傾角)——有軌道要素的天體才有;衛星/冥衛一改顯示軌道半徑與母行星名稱(它們用的是比較簡化的圓形軌道模型)。

## 網址分享狀態(URL Shareable State,v0.8)

網址列會即時反映目前的模擬時間與攝影機視角——任何時候複製網址,都能還原
成同一個畫面:

- **會存**——模擬時間、攝影機模式、焦點天體(日心俯瞰/地心視角)、
  行星表面模式的 planet/緯度/經度。
- **不會存**——播放速度/方向/暫停狀態、自由飛行模式的位置/視角方向、
  Event Toolkit 或 Observer Mode 的輸入。
- 用 `history.replaceState` 即時更新,不會因為播放時間或到處飛而堆出一堆
  瀏覽紀錄。
- 手動改壞的網址(不存在的模式、超出範圍的經緯度、無效日期)會安靜地
  改用預設值,不會讓頁面壞掉。

## 手機觸控支援(Mobile Touch Controls,v0.10)

在觸控裝置上(用 `(pointer: coarse)` 偵測)會自動出現虛擬搖桿與
Prev/Next 按鈕——桌面版完全不受影響、不會多出任何 UI。

- **Free-flight / Surface**——左下角虛擬搖桿控制移動(前進/側移,或
  行星表面的經緯度走動),跟 WASD 同時可用,不是取代它。
- **Free-flight / Geocentric**——在畫面上拖曳可以改變視角方向,跟滑鼠
  拖曳一樣。
- **Geocentric**——右下角 ◀/▶ 按鈕切換目前追蹤的行星(WASD 的觸控等效
  操作)。
- **Top-Down**——沒變:這個模式本來就用 `OrbitControls`,本身就有內建
  touch 支援(單指旋轉、雙指縮放/平移)。
- 點擊天體選取(Planet Info Panel)現在觸控裝置上也能用了——之前這個
  功能只綁在滑鼠 hover 狀態上,觸控完全沒反應。
- **已知限制**:Free-flight 的垂直移動(原本鍵盤 Q/E)沒有對應的觸控
  控制;觸控筆電如果滑鼠是主要指標裝置,不會顯示觸控 UI(即使觸控實際
  可用)。

## 資料來源

- 軌道要素:JPL Solar System Dynamics 低精度克卜勒軌道要素表(Standish 1992),適用約 1800–2050 年。
- 即時位置:[JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)(不需 API key)。
- 貼圖:詳見下方[資產授權](#資產授權)。

## 桌面應用程式(Tauri)

用 [Tauri](https://tauri.app/) 把同一個靜態網站包成原生視窗(不是
Electron——用作業系統自帶的 WebView,不內建 Chromium)。需要
[Rust 工具鏈](https://rustup.rs/)才能 build。

```bash
npm install
npm run tauri:dev     # 原生視窗,直接對著原始碼跑
npm run tauri:build   # 產生真的 .app/.dmg(macOS)安裝包
```

- **預設就離線可用**——這正是為什麼 THREE.js 要地化到本地(見下方
  [資產授權](#資產授權)),而不是從 CDN 載入:桌面版打包好之後如果沒有
  網路就白屏,那就不算真的離線可用。
- **視窗標題/圖示**跟**視窗大小/位置**(用官方 `tauri-plugin-window-state`
  外掛記憶,跨次啟動)都設定在 `src-tauri/tauri.conf.json` /
  `src-tauri/src/lib.rs`。
- App 圖示(`assets/icon-source.png`)目前是占位圖——換成正式美術素材後
  重跑 `npx tauri icon assets/icon-source.png` 就能更新全套圖示。
- **目前範圍不含**:自動更新、原生選單/系統匣/通知、發布用的程式碼
  簽署與公證、行動裝置平台。

## 目前狀態

v1 版本——桌面應用程式打包(見上方)已經做了;正式簽署 build 的安裝包/
自動更新發布流程還沒有。

## 資產授權

程式碼採 MIT 授權(見下方[授權](#授權)),但 `assets/textures/` 底下的第三方行星/衛星貼圖各自保留原始授權——MIT 不會改變它們的授權條款。完整的逐檔案清單、來源與 credit,請見:**[ATTRIBUTION.md](ATTRIBUTION.md)**。

行星貼圖主要基於 [Solar System Scope](https://www.solarsystemscope.com/textures/) 的素材,採 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 授權,並依網頁渲染需求做過修改。部分衛星貼圖(木衛一 Io、木衛二 Europa、木衛三 Ganymede、土衛六 Titan、海衛一 Triton、冥衛一 Charon)則來自 Steve Albers / NOAA Science On a Sphere,以 NASA 原始影像整理而成。貼圖由 `scripts/fetch-textures.mjs`(`npm run fetch-textures`)下載,不是手動 commit 上去的——之後隨時可以重跑這個腳本來更新,或補上目前還沒找到穩定來源的天體(清單見 `ATTRIBUTION.md` 的 TODO 區塊)。

## 貢獻

參見 [CONTRIBUTING.md](CONTRIBUTING.md)(英文)——本地開發環境、程式碼慣例
(單位要寫進變數名、座標來源要明確、新增分析功能的測試要求)、素材授權規則。

## 授權

MIT(僅限程式碼——第三方貼圖授權見上方[資產授權](#資產授權))
