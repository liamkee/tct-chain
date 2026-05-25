我要做一個預測gym formula 的東西

我們需要：
1. gym room 的數值
   - 數據已整理在 `data/gym_data.json` 中。
   - 注意：Torn 官方 API 返回的健身房 dots（倍率）是 Wiki 上數值的 10 倍（例如 Premier Fitness 在 Wiki 為 2.0，API 返回 20），在使用公式計算時需要除以 10。

2. 有什麽加成的地方（Gym Gain Modifiers） —  雙重確認（完全乘法互乘機制） 
   Torn 的所有訓練加成並非加法相加，而是以【乘法互乘】的方式作用。總加成 Perks ＝ 屬性特定加成 × 全局加成。

   以下是整理出的所有加成因子：
   - 物業加成 (Property Perks) — 全局加成
     - 來自玩家所住物業的 `"gym gains"` 屬性（如 Private Island 升級）。
     - 計算方式：`modifierAll *= 1 + (property_perk_percent / 100)`（例如 +10% 則乘 1.10）。
   - 教育加成 (Education Perks) — 乘法加成
     - 完成體育科學（Sports Science）課程獲得：
       - `SPT3510` (Bachelors)：全局加成 `modifierAll *= 1.01` (+1%)。
       - `SPT2440` (Strength)：力量加成 `modifierStr *= 1.01` (+1%)。
       - `SPT2450` (Speed)：速度加成 `modifierSpe *= 1.01` (+1%)。
       - `SPT2460` (Defense)：防禦加成 `modifierDef *= 1.01` (+1%)。
       - `SPT2470` (Dexterity)：敏捷加成 `modifierDex *= 1.01` (+1%)。
   - 公司技能加成 (Company Perks) — 乘法加成
     - 玩家在特定公司上班獲得的 Passive 技能：
       - 全局加成：`"gym gains"`（如 +3% 全局增益） $\rightarrow$ `modifierAll *= 1.03`。
       - 屬性特定加成（如 Fitness Center 健身房公司）：
         - 敏捷加成：`"dexterity gym gains"` $\rightarrow$ `modifierDex *= 1.10` (+10%)。
         - 防禦加成：`"defense gym gains"` $\rightarrow$ `modifierDef *= 1.10` (+10%)。
   - 幫派技能加成 (Faction Perks - Steadfast) — 乘法加成
     - 幫派 Steadfast 分支升級：
       - 提取加成百分比 $n$（如幫派加成為 12%），轉為乘數 `1.12`。
       - 作用於對應屬性：`modifierStr/Spe/Def/Dex *= 1 + (n / 100)`。
   - 功績勳章加成 (Merits Upgrade) — 間接加成（極重要區分！）
     - 注意：Torn 中【沒有】直接增加「Gym Gain %」的 Merit 升級。
     - Merits 中的屬性加成（Biter 力量, Protection 防禦, Athletic 速度, Nimble 敏捷，每級 +3%，最高 +30%）是**直接提升玩家的基礎戰鬥屬性（Base Battle Stats）**。
     - 這會通過擴大 Vladar 公式中的 $S$（Battle Stat）數值，進而【間接】大幅提升訓練產出，但它不作為 perks 乘數進入公式。
   - 書籍加成 (Book Perks) — 乘法加成（效果極強）
     - 玩家閱讀特定的 Buff 書籍：
       - 全局加成：`"all gym gains"` $\rightarrow$ `modifierAll *= 1.20` (+20%)。
       - 屬性特定加成：`"strength/defense/speed/dexterity gym gains"` $\rightarrow$ 對應屬性 `modifierStr/Def/Spe/Dex *= 1.30` (+30%)。

3. happy 的 loss 計算與增加管道
   - Happy Loss（每次訓練扣除）：
     - **真實遊戲機制 (RNG)**：每次訓練消耗的 Happy 是消耗能量的 `40% ~ 60%` 隨機浮動值。
     - **長期預測公式**：為了預算總體收益，各大計算器（含本引擎）採用 50% 期望值作為基準估算：$dH = \text{ROUND}(\text{energy_spent} / 2, 0)$
     - 5e 訓練：預估扣除 3 Happy (真實浮動: 2 ~ 3)
     - 10e 訓練：預估扣除 5 Happy (真實浮動: 4 ~ 6)
     - 25e 訓練：預估扣除 13 Happy (真實浮動: 10 ~ 15)
   - Happy 增加管道：
     - 自然回復：每 5 分鐘按物業（Property）基礎上限自然回復。
     - 糖果/道具（Candies）：Lollipop (+50), Chocolate (+70), Big Box of Chocolate (+150)。
     - 核心道具（Happy Jump 核心）：Erotic DVD (+2500~3000+ Happy)。
     - 毒品（Ecstasy / 搖頭丸）：將當前幸福度翻倍（Double Current Happy），上限為 99,999。

4. random 數值推測
   - Vladar 公式計算出的是**精確期望值**。
   - Torn 實際 Gym 訓練存在極小幅度的隨機浮動波動（約 $\pm 0\%$ 至 $\pm 5\%$ 的隨機隨機噪聲），通常可忽略不計，期望值對鏈條和練點估算已足夠精準。

5. energy 消耗機制
   - 每次訓練消耗 $5e$ (普通健身房), $10e$ (中級健身房), $25e$ (高級/專門健身房)

6. 預測底層核心公式 (Modern Vladar Formula)
   這是目前 **最新、最精準** 的核心公式（也是當前各大主流計算器如 TornStats、TornCalc 的底層依據）。它通過數萬個真實玩家的數據擬合得出：

   $$Gain = \left[ S_{\text{effective}} \times f(H) + 8 \times H^{1.05} + \left(1 - \left(\frac{H}{99999}\right)^2\right) \times A + B \right] \times \frac{1}{200,000} \times \text{dots} \times \text{energy} \times \text{perks}$$

   #### 1. 核心非線性升級點：
   *   **幸福度非線性效應（$8 \times H^{1.05}$）**：
       引入了 $H^{1.05}$ 的非線性冪次項。在低屬性、高幸福度（Happy Jump 階段），這個非線性項在公式中占絕對主導地位，解決了舊版線性公式在 Happy Jump 預測上的巨大系統誤差。
   *   **幸福度與常數的動態飽和（$1 - (H/99999)^2$）**：
       這項代表幸福度對基礎增益的飽和遞減效應。當幸福度 $H$ 逼近上限 $99,999$ 時，這一項會趨近於 $0$，消除常數因子 $A$ 的影響，體現了遊戲設計的精細度。
   *   **幸福度對數乘數（$f(H)$）**：
       $$f(H) = \text{ROUND}\left( 1 + 0.07 \times \text{ROUND}\left( \ln\left(1 + \frac{H}{250}\right), 4 \right), 4 \right)$$
       用對數 $\ln(1 + H/250)$ 來擬合高幸福度下屬性增幅的飽和曲線。

   #### 2. 超過 50M 屬性的對數衰減公式（Stat Cap Log-decay）：
   這也是最新公式最顯著的特徵。當屬性 $S > 50,000,000$ 時，增幅並非完全靜止，而是遵循以下對數遞減：
   $$S_{\text{effective}} = 5 \times 10^7 + \frac{S - 5 \times 10^7}{8.77635 \times \ln(S)}$$
   這能精確模擬出 50M 以上屬性時，仍有極其微弱但存在的收益增長。

   #### 3. 四大屬性專屬常數因子 $[A, B]$（四大屬性解耦）：
   為了解決舊公式中「四屬性通用」的偏差，新公式為四大屬性分別量身定做了常數偏置，使得預測達到千分之一級別的恐怖精度：
   - 力量 (Strength): $A=1600, B=1700$
   - 速度 (Speed): $A=1600, B=2000$
   - 敏捷 (Dexterity): $A=1800, B=1500$
   - 防禦 (Defense): $A=2100, B=-600$

