# BakeSuite (AI-01) — Frontend Features & Architecture Master Guide (`brain.md`)

Yeh document BakeSuite AI-01 Demand Forecasting ke frontend dashboard ke har aik feature, uske visual elements, aur peeche chalne wale backend/machine learning process ko Roman Urdu mein tafseel se bayan karta hai taake samajhna nihayat aasan ho.

---

## 1. Left Sidebar (Navigation & Diagnostics)

### 1.1 Master Branding Header (`BS BakeSuite`)
* **Screen par kya dikhta hai:** "BS BakeSuite (ERP Intelligence)" ka logo aur title.
* **Process & Kaam:** Yeh application ka main navigation header hai. Is se user ko confirm hota hai ke woh BakeSuite ke AI Demand Intelligence suite ke andar authenticated hain.

### 1.2 Forecast Workbench (AI-01) — (Active)
* **Screen par kya dikhta hai:** Active state mein highlighted menu item.
* **Process & Kaam:** Yeh wo main dashboard screen hai jahan Machine Learning (LightGBM Quantile Regression + SARIMAX baseline) ki probabilistic demand forecasting aur 35-day forward production planning dikhti hai.

### 1.3 Branch Indent Plan (Advisory Planning View)
* **Screen par kya dikhta hai:** Secondary navigation link.
* **Process & Kaam:** Har branch ki daily store requisitions. Branch managers is screen ko dekh kar central warehouse ya kitchen ko indent bhejte hain ke unke paas shelf par kitna stock bacha hai aur aane wale dinon ke liye kitne units dispatch karne hain.

### 1.4 Central Kitchen Bake (Production Scheduling)
* **Screen par kya dikhta hai:** Kitchen operations navigation link.
* **Process & Kaam:** Central kitchen ke commercial deck aur rotary ovens ka production batch scheduling view. AI ki P50/P90 demand predictions ko oven capacity aur shelf life ke mutabiq batching schedules mein convert karta hai.

### 1.5 Purchase Requirements (Raw Material BOM Calculation)
* **Screen par kya dikhta hai:** Procurement navigation link.
* **Process & Kaam:** Finished bakery items (Cakes, Breads, Pastries) ke forward demand ko Bill-of-Materials (BOM) ke zariye raw materials (Maida, Cheeni, Makhan/Ghee, Anday, Chocolate) ki khareedari ke schedule mein tabdeel karta hai.

### 1.6 Regional & Diagnostics Box
* **Live PKT Time:** Screen par real-time digital clock har second chalti hai (e.g. `14:20:48 PKT`). Yeh browser time nahi balkay strictly **Asia/Karachi** (Pakistan Standard Time) ke mutabiq chalti hai.
* **Timezone:** `Asia/Karachi (PKT, UTC+5)`. Tamam business dates raat 12:00 PKT par rollover hoti hain.
* **Date Format:** `DD-MM-YYYY` (Pakistani commercial date standard, e.g. `24-09-2026`).
* **Currency:** `PKR (Rs)` — Tamam revenue, unit prices, aur sales projections Pakistani Rupee mein format hoti hain (e.g. `Rs 1,250,000.00`).

### 1.7 ML Service Status Indicator & Outage Simulation
* **Green Dot (ML Service Link):** 
  * *Process:* Frontend har 30 seconds baad backend proxy ke zariye Python FastAPI ML Microservice ke `/health` endpoint ko check karta hai. Agar service live ho to Green Dot dikhta hai.
* **Simulate Outage (AC-4) Button:** 
  * *Process:* Yeh QA aur testing ke liye banaya gaya hai. Is par click karne se ERP Core circuit breaker ko trip karwa kar ML service ko unreachable simulate karta hai.
  * *Fallback Execution:* System crash ya blank nahi hota, balkay foran **AC-4 Deterministic 4-Week Fallback Engine** par switch ho jata hai (pichlay 4 hafton ke same-weekday medians uthata hai aur UI par 'Fallback estimate' ka badge dikhata hai).

---

## 2. Top Header & Live Status Bar

### 2.1 Page Title & Probabilistic Subtitle
* **Title:** `Forecast Workbench — AI-01 Probabilistic Demand Intelligence (P10 / P50 / P90)`
* **Process & Kaam:** Yeh zahir karta hai ke BakeSuite sirf aik single number prediction nahi deta, balkay 3 quantiles deta hai taake bakery manager risk management kar sake.

### 2.2 35-Day Horizon Active (Green Badge / Guardrail)
* **Screen par kya dikhta hai:** Green pill badge `35-Day Horizon Active`.
* **Process & Kaam:** SRS standard ke mutabiq AI-01 system maximum **35 days forward** forecast generate karta hai. Agar koi API client ya rogue request 36 din ya us se zyada mangti hai, to backend guardrail foran request ko reject kar ke `HTTP 422 Unprocessable Content` return karta hai.

### 2.3 Last Batch Scored Status
* **Screen par kya dikhta hai:** `Last batch: 11:27:26 PKT (32 SKUs)`
* **Process & Kaam:** Yeh koi hard-coded text nahi hai. Backend PostgreSQL table `ml.model_run_ledger` se latest successful batch scoring run ka timestamp aur scored SKUs ki ginti dynamically fetch kar ke display karta hai.

---

## 3. Filter & Action Bar

### 3.1 Branch Location Dropdown
* **Options:** 
  * `BR-KHI-01: BakeSuite Clifton (Flagship)`
  * `BR-LHR-01: BakeSuite Gulberg (Commercial)`
  * `BR-ISB-01: BakeSuite F-7 Markaz (Boutique)`
* **Process & Kaam:** Branch select karte hi frontend tamam metrics, chart, aur SKU grid ko us specific branch ke geographical features, temperature, aur local demand ke mutabiq reload karta hai.

### 3.2 Category Filter Dropdown
* **Options:** `All Categories`, `Breads & Buns (BREAD)`, `Cakes (CAKE)`, `Pastries & Tarts (PASTRY)`, `Savories & Patties (SAVORY)`, `Traditional Sweets (SWEET)`, `Hot & Cold Beverages (BEVERAGE)`.
* **Process & Kaam:** Table aur KPI cards ko real-time filter karta hai. Category change karne se summary cards ka total demand aur revenue foran recalculate hota hai.

### 3.3 Search SKU Input
* **Screen par kya dikhta hai:** Text box jismein search icon hai.
* **Process & Kaam:** User kisi bhi product ka naam (e.g. `Karak`, `Fudge`, `Sourdough`) ya SKU code (e.g. `SKU-BEV-01`) type kare, to table foran filter ho jati hai.

### 3.4 Refresh Data Button
* **Process & Kaam:** Database aur API endpoints se taaza forecast dobara fetch karta hai, caches re-validate karta hai aur chart ko re-render karta hai.

### 3.5 Export CSV Button
* **Process & Kaam:** Screen par maujood active grid data ko aik click mein client-side parse karke formatted `.csv` spreadsheet file bana kar user ke computer par download kar deta hai (SKU, Name, Category, Date, P10, P50, P90, Confidence, Revenue shamil hoti hain).

### 3.6 Rescore AI Button
* **Process & Kaam:** Agar kisi product ki promotion lagayi gayi ho ya price change ki gayi ho, to yeh button dabane se ML service ke `/api/v1/ai/forecast/batch-rescore` endpoint par fast inference request bheji jati hai (guardrail: maximum 500 items). LightGBM foran naye features ke sath quantiles predict karta hai aur database update ho jati hai.

---

## 4. Top 4 KPI Summary Cards

### 4.1 35-Day Forward Demand
* **Screen par kya dikhta hai:** Total forecasted units (e.g. `16 Units` ya `1,420 Units`).
* **Process & Kaam:** Filter shuda category aur branch ke forward demand horizon ke تمام P50 expected units ka mathematically aggregated sum hota hai.

### 4.2 Projected Forward Revenue
* **Screen par kya dikhta hai:** Expected Pakistani Rupee amount (e.g. `Rs 30,400.00`).
* **Process & Kaam:** Har product ki forecasted P50 quantity ko uski master price list (`public.price_lists`) se multiply karke total projected gross sales calculate ki jati hain:
  $$\text{Projected Revenue} = \sum (\text{Forecasted P50 Quantity} \times \text{Unit Selling Price PKR})$$

### 4.3 High-Confidence Share
* **Screen par kya dikhta hai:** Percentage rate (e.g. `85%` ya `0% / Human Review Required`).
* **Process & Kaam:** Jin items ka model confidence score $\ge 75\%$ ($0.75$) hota hai, unko high confidence shumar kiya jata hai. Agar score $0.75$ se kam ho to card automatically amber alert show karta hai aur manager ko manual review ki hidayat deta hai.

### 4.4 Governing Lunar Event
* **Screen par kya dikhta hai:** Islamic Calendar status (e.g. `Normal Trade Day`, `Ramadan Fasting Spike`, `Eid-ul-Fitr Horizon`, `Chand Raat Peak`).
* **Process & Kaam:** Table `ml.fg_calendar_day` se current aur aane wale dinon ke Hijri lunar dates aur Pakistani gazetted holidays ko track karta hai. Model is feature ko demand forecasting mein heavy weight deta hai.

---

## 5. Demand Trajectory Time-Series Chart (Chart.js)

### 5.1 Chart Layout & Header
* **Title:** Selected SKU ka naam aur code (e.g. `Demand Trajectory: 28-Day Actuals vs 14-Day Forecast — Special Karak Doodh Patti (SKU-BEV-01)`).
* **Subtitle:** Branch ID, Forward P50 Anchor value, aur model details.

### 5.2 Time-Series Lines & Visualizer Elements
1. **Blue Solid Line (`Historical Actuals`):**
   * Pichlay 28 dinon (`2026-08-21` se `2026-09-17`) mein bakery branch par us item ki actual POS sales demand ka graph.
2. **Orange Solid Line (`P50 Forecast`):**
   * Aane wale 14 dinon (`2026-09-18` se `2026-10-01`) ki median forecast trajectory jo LightGBM quantile model ne calculate ki hai.
   * Jummah, Saturday aur Sunday ke weekend spikes is line par wazeh nazar aate hain.
3. **Anchor Point (Zero-Gap Junction):**
   * Day 28 ki aakhri actual value aur Day 29 ki pehli forecast value aapas mein perfectly judti hain taake timeline continuous rahe aur koi gap na aaye.
4. **Yellow Shaded Uncertainty Band (`P10–P90 Interval`):**
   * **P10 (Neechay ki dashed line):** 10th percentile (Pessimistic Scenario) — 90% yaqeen hai ke demand is se kam nahi hogi. Production team is se kam bake na kare warna customers khali haath jayenge.
   * **P90 (Ooper ki dashed line):** 90th percentile (Peak Optimistic Scenario) — 90% yaqeen hai ke demand is se zyada nahi hogi. Is se zyada banana wastage aur shelf spoilage peda karega.

---

## 6. SKU Indent & Bake Plan Grid (Data Table)

Table mein branch ke tamam products row-by-row display hote hain:

| Column Name | Kya Display Karta Hai | Behind The Scenes Process |
| :--- | :--- | :--- |
| **SKU Information** | Product ka naam aur code | Kisi bhi row par click karne se ooper chart foran us SKU ka ban jata hai. |
| **Category** | Tag (e.g. `BEVERAGE`, `CAKE`) | Filter grouping identifier. |
| **Forecast Date** | Business date (`2026-09-24`) | Jis din ke liye planning ki ja rahi hai. |
| **P10 Lower** | Units (e.g. `6 PCS`) | Lower demand bound (safety floor). |
| **P50 Expected** | Units (e.g. `14 PCS`) | Recommended baking quantity (median baseline). |
| **P90 Upper** | Units (e.g. `15 PCS`) | Peak buffer ceiling. |
| **Confidence** | Badge (e.g. `High 88%` ya `Low 45%`)| Model residuals aur variance se calculate kiya gaya statistical score. |
| **Expected Sales** | PKR currency (e.g. `Rs 2,520.00`) | $\text{P50} \times \text{Unit Price}$. |
| **Event Context**| Badge (e.g. `Normal`, `Weekend Peak`) | Regional calendar dynamics. |
| **Actions** | `Override` aur `Details` buttons | Manual interventions aur AI explainability modals. |

---

## 7. Actions & Interactive Modals

### 7.1 Manual Forecast Override Modal
* **Kyun zaroori hai:** Agar branch manager ko pata ho ke kal school ya corporate party ka advance catering order hai jo ML model ko nahi pata, to manager forecast badha sakta hai.
* **Process:**
  1. Manager `Override` button par click karta hai.
  2. Modal khulta hai jahan naya P50 number, Reason Code (`CATERING_ORDER`, `LOCAL_EVENT`, `WEATHER_DISRUPTION`), aur Notes enter kiye jaate hain.
  3. Form submit hote hi `POST /api/v1/ai/forecasts/override` call hota hai.
  4. Database table `ml.forecast_overrides` mein full audit log banta hai (User ID, Timestamp, Original Value, Override Value, Reason).
  5. UI par foran **"Overridden (Manual)"** ka badge lag jata hai aur **Revert** button show ho jata hai.

### 7.2 AI Explainability Modal (SHAP & Feature Importance)
* **Kyun zaroori hai:** Black-box AI par andha aetimad karne ke bajaye manager ko pata chalna chahiye ke model ne yeh number kyun predict kiya.
* **Process:**
  * `Details` button par click karne se explainability panel khulta hai jo batata hai:
    * **Lag-7 & Lag-14 Sales Weight:** Pichlay hafte is din kitni sales huwi theen.
    * **Rolling 7-Day Moving Average:** Demand ka trend upward hai ya downward.
    * **Calendar / Weekend Multiplier:** Friday/Sunday ki wajah se demand kitne guna barhi.
    * **Temperature / Rain Impact:** Barish ya shadeed garmi ka hot beverage ya ice cream par asar.

---

---

## 8. Branch Indent Plan Screen (Module 2 Deep Dive)

Jab user left sidebar se **Branch Indent Plan** par click karta hai, to Store Requisition aur Dispatch Logistics ka view khulta hai (jaisa ke image mein nazar aa raha hai).

### 8.1 Header & Operational Notice
* **Header Title:** `Branch Indent Plan`
* **Subtitle:** `Branch Daily Store Requisitions & Stock Dispatch Logistics`
* **35-Day Horizon Active & Last Batch Timestamp:** Top right par live ML execution timestamp (`11:27:26 PKT (32 SKUs)`) aur guardrail active rehta hai.
* **Advisory Planning Banner (Blue Box):**
  > ℹ️ **Advisory Planning View:** Requisitions calculated from latest branch stock movements and AI P50 demand. Human review required prior to store dispatch.
  * *Process & Maqsad:* AI sirf mathematical recommendation deta hai. Store dispatch se pehle branch manager ka physical inspection aur human sign-off zaroori hota hai taake kitchen se branch tak dispatch mein over-stocking ya food waste na ho.

---

### 8.2 Filters & Global Action Bar
1. **TARGET BRANCH Dropdown (`BR-KHI-01: BakeSuite Clifton Flagship`):**
   * Har retail branch (Clifton, Gulberg, F-7) ka apna alag shelf space aur demand hota hai. Branch badalne par us branch ke specific indent numbers load hote hain.
2. **INDENT STATUS Dropdown (`All Statuses`):**
   * Filter options: `All Statuses`, `Advisory Review`, `Approved`, `Dispatched`.
3. **FILTER SKU Input (`Search branch items...`):**
   * Real-time search box. Type karte hi table mein matching products (e.g. `Karak`, `Coffee`, `Pastry`) filter ho jaate hain.
4. **Approve All Pending Button (Green):**
   * Agar branch manager ne saari quantities verify kar li hon, to aik click mein tamam 32 SKUs ko bulk approve kar sakta hai.
5. **Export Indents (CSV) Button:**
   * Is button par click karne se active branch ka complete indent plan formatted Excel/CSV spreadsheet file mein download ho jata hai jismein Dispatch Drivers aur Kitchen Storekeeper ke liye SKU code, suggested quantity aur approved quantity shamil hoti hai.

---

### 8.3 Top 4 KPI Summary Cards (Indent Metrics)
Image mein 4 key metrics cards hain jo pure branch ki requisition summary batate hain:

1. **TOTAL INDENT DEMAND (`262 PCS` — Advisory Requisition):**
   * *Formula:* Tamam 32 SKUs ki approved quantities ka live mathematical sum ($\sum \text{Approved Qty}$).
   * Stepper se kisi bhi item ki quantity change karne par yeh total card foran real-time update ho jata hai!
2. **PENDING APPROVAL (`32 SKUs` — Requires Branch Sign-off):**
   * Kitne SKUs abhi tak `Advisory Review` stage mein hain jinko manager ne sign-off karna hai.
3. **DISPATCHED TO STORE (`Integration Pending`):**
   * Central Kitchen ke dispatch truck / WMS integration ki live logistics status.
4. **STOCKOUT RISK LEVEL (`Advisory Buffer Intact`):**
   * Safety buffer health indicator. Jab tak store ka projected stock safety threshold se ooper ho, yeh green status "Buffer Intact" dikhata hai.

---

### 8.4 Branch Daily Requisitions & Store Safety Buffers Grid (Data Table)
Table ke ooper counter likha hota hai: `Showing 32 of 32 advisory requisitions`. Is table ka har column specific logistics purpose rakhta hai:

| Column Header | Value in Image | Technical Process & Meaning |
| :--- | :--- | :--- |
| **SKU INFORMATION** | *Special Karak Doodh Patti (SKU-BEV-01)*<br>*Espresso Roast Coffee (SKU-BEV-02)*<br>*Dark Belgian Hot Chocolate (SKU-BEV-03)* | Product ka commercial name aur unique SKU identifier. |
| **CATEGORY** | `BEVERAGE` | Product group tag. |
| **SHELF STOCK** | `Integration Pending` | Branch ke physical display counters aur chiller par maujood current stock level (WMS integration link). |
| **SAFETY MIN** | `Advisory Buffer` | Minimum inventory threshold taake customer ko "Out of Stock" na mile. |
| **AI P50 DEMAND** | **`9 PCS`**, **`8 PCS`**, **`8 PCS`** | Machine learning model ka predict kiya gaya median consumer demand. |
| **SUGGESTED INDENT** | `9 PCS*`, `8 PCS*` | Recommended replenishment quantity ($\text{P50 Demand} + \text{Safety Buffer} - \text{Shelf Stock}$). |
| **APPROVED QTY** | **Interactive Stepper: `[- 9 +]`** | Manager ke paas full control hota hai. `+` ya `-` dabane se quantity 5-5 units barhti/kam hoti hai. Minimum limit zero hai. |
| **STATUS** | `Advisory Review` (Amber badge) | Requisition approval workflow stage. |
| **ACTIONS** | `Review` Button | Click karne par dispatch verification toast show hota hai aur item review mark ho jata hai. |

---

---

## 9. Central Kitchen Bake Plan Screen (Module 3 Deep Dive)

Jab user sidebar se **Central Kitchen Bake** select karta hai, to bakery ke main manufacturing kitchen ke ovens aur batching schedule ka view khulta hai (jaisa ke image mein nazar aa raha hai).

### 9.1 Screen Header & Kitchen Banner
* **Title & Subtitle:** `Central Kitchen Bake Plan — Commercial Deck & Rotary Oven Batch Scheduling (Advisory Prototype)`
  * AI demand forecast ko central production kitchen ke ovens aur manufacturing lines ke schedules mein convert karta hai.
* **Advisory Prototype Warning (Amber Box):**
  > ⚠️ **Advisory Prototype View:** Master Recipe/BOM & commercial deck/rotary oven equipment scheduling integration pending. Schedules are advisory planning models.
  * *Maqsad:* Ovens ko direct automated physical trigger karne ke bajaye yeh planning model Head Chef aur Master Baker ke liye dispatch batches ki calculation karta hai.

---

### 9.2 Filters & Kitchen Controls
1. **BAKING SHIFT Dropdown (`Morning Shift (04:00 - 12:00 PKT)`):**
   * Commercial bakeries 24/7 shifts par chalti hain. Morning shift subah 04:00 bajay shuru hoti hai taake subah 07:00 bajay tak taaza Double Roti (Breads), Sheermal, Croissants aur breakfast savories branches par deliver ho sakein.
2. **OVEN / EQUIPMENT Dropdown (`All Stations (4 Ovens + 2 Lines)`):**
   * Filter stations: `Deck Oven A`, `Deck Oven B`, `Rotary Rack 1`, `Convection Line 2`.
3. **Schedule Emergency Batch Button (Gold):**
   * Agar kisi branch par shaam ke waqt stockout hone lage ya koi VIP bulk order aaye, to emergency baking batch insert karne ke liye.
4. **Print Bake Sheet (CSV) Button (Dark):**
   * Kitchen baking supervisor ke clipboard ke liye printable baking sheet generate karta hai taake oven operators har batch ki timing aur temperature monitor kar sakein.

---

### 9.3 Top 4 KPI Summary Cards (Kitchen Metrics)
1. **SCHEDULED BATCHES (`10 Batches` — Advisory Plan):**
   * Active shift ke doran tamam consolidated SKUs ko bake karne ke liye kul kitne batches run honge.
2. **COMMERCIAL OVEN CAPACITY (`--` with visual capacity meter):**
   * Deck aur rotary ovens ka utilization percentage (Green: Safe, Gold: Optimum, Red: Overloaded).
3. **CURRENT BAKING SHIFT (`Morning Shift (04:00 - 12:00 PKT)`):**
   * Kitchen timing context indicator.
4. **READY FOR STORE DELIVERY (`Advisory View`):**
   * Finished bakery goods ke packaging aur cooling racks se dispatch hone ki readiness status.

---

### 9.4 Central Kitchen Master Baking Schedule Grid (Data Table)
Table header kehta hai: `Consolidated branch demand, batch counts, oven loading, and stage workflow (Showing 10 advisory production batches)`.

| Column Header | Value in Image | Technical Process & Baking Physics |
| :--- | :--- | :--- |
| **BATCH CODE** | **`PLAN-101`**, **`PLAN-102`**, **`PLAN-103`** (Gold monospace) | Har batch ka unique traceability code. |
| **PRODUCT NAME** | *Special Karak Doodh Patti* (`SKU-BEV-01`)<br>*Espresso Roast Coffee* (`SKU-BEV-02`)<br>*Dark Belgian Hot Chocolate* (`SKU-BEV-03`) | Bakery item name aur product code. |
| **CATEGORY** | `BEVERAGE`, `BREAD`, `CAKE` | Item category. |
| **CONSOLIDATED DEMAND** | **`9 PCS`**, **`8 PCS`** | Tamam branches (Clifton, Gulberg, F-7) ka milaya hua total production target. |
| **BATCH SIZE** | `60 / batch` | Single tray/oven load capacity (Breads: 50, Cakes: 12, Pastries: 60). |
| **BATCHES REQUIRED** | **`1`** | Formula: $\lceil \text{Consolidated Demand} / \text{Batch Size} \rceil$. Agar demand 65 ho aur batch size 60 ho, to 2 batches run honge. |
| **ASSIGNED STATION** | `Deck Oven A`, `Deck Oven B`, `Rotary Rack 1` | Commercial equipment jahan yeh item bake hoga (Heavier breads Deck ovens mein, pastries convection mein). |
| **TEMP & TIME** | `190°C / 25m`, `220°C / 30m`, `175°C / 45m` | Baking temperature aur time settings jo perfect crust aur texture ke liye zaroori hain. |
| **CURRENT STAGE** | `Advisory Plan` | Production stage: Proofing $\rightarrow$ Baking $\rightarrow$ Cooling $\rightarrow$ Packing. |
| **ACTION** | `Advisory Prototype` | Status indicator. |

---

## 10. Purchase Requirements Screen (Module 4 Deep Dive)

Jab user sidebar se **Purchase Requirements** select karta hai, to finished goods (Cakes, Breads, Pastries) ke forward demand ko raw materials (BOM - Bill of Materials) mein convert karne ka **Material Requirements Planning (MRP)** view khulta hai (jaisa ke image mein nazar aa raha hai).

### 10.1 Screen Header & Procurement Banner
* **Title & Subtitle:** `Purchase Requirements — Raw Material Explosion & Ingredient Requisitions (Advisory Prototype)`
  * AI demand forecast ke mutabiq kacha maal (Maida, Cheeni, Makhan/Ghee, Anday) khareedne ki planning screen.
* **Advisory Warning Banner (Amber Box):**
  > ⚠️ **Advisory Prototype View:** Central procurement ERP database integration pending. Automatic purchase order creation is disabled.
  * *Maqsad:* AI seedhe vendor ko purchase order trigger nahi karta balkay procurement officer ko advisory shopping list dikhata hai taake woh rate negotiate karke vendor ko order bhej sake.

---

### 10.2 Filters & Procurement Controls
1. **MATERIAL URGENCY Dropdown (`All Ingredients (BOM Explosion)`):**
   * Filter options: Tamam raw ingredients, ya sirf critical shortage items.
2. **Review Purchase Recommendations Button (Gold Outline):**
   * Procurement manager tamam suggested quantities aur rates ko review karke vendor approval list mein transfer karta hai.
3. **Export BOM Requisition (CSV) Button (Dark):**
   * Supply chain manager aur purchasing department ke liye raw material purchase orders ki Excel/CSV sheet download karta hai.

---

### 10.3 Top 4 KPI Summary Cards (Procurement Metrics)
Image mein 4 key metrics cards hain jo pure bakery chain ke raw materials ki health batate hain:

1. **CRITICAL SHORTAGE ITEMS (`Advisory Check` / Red Alert — Advisory Buffer Check):**
   * Raw materials mein agar kisi ingredient (e.g. Maida ya Ghee) ka stock dangerous level par kam ho jaye to yeh alert karta hai taake production band na ho.
2. **OPEN PURCHASE ORDERS (`ERP Integration Pending`):**
   * Vendors ke sath kitne purchase orders (POs) abhi open ya transit mein hain.
3. **EST. REQUISITION VALUE (`Advisory Pending` — Rs Icon / Planning Model):**
   * Raw materials khareedne ke liye kitna working capital (Cash in PKR) darkar hoga ($\sum \text{Shortfall} \times \text{Unit Rate PKR}$).
4. **WAREHOUSE SAFETY STOCK (`--` — Advisory Buffer):**
   * Central raw material warehouse ka reserve stock indicator.

---

### 10.4 Raw Material Requisitions & Bill-of-Materials Explosion Grid (Data Table)
Table header kehta hai: `Derived dynamically from central baking schedule to ensure continuous operation (Showing 4 raw baking ingredients (Advisory))`.

Yeh table BOM Explosion ke zariye finished items ko bunyadi ajza (ingredients) mein torti hai:

| Column Header | Value in Image | Commercial Procurement Meaning |
| :--- | :--- | :--- |
| **RAW MATERIAL** | *Fine Maida Flour (Grade A Extra White)* (`MAT-FLR-01`)<br>*Premium Refined Castor Sugar* (`MAT-SGR-01`)<br>*Bakery Shortening Ghee / Butterfat* (`MAT-FAT-01`)<br>*Fresh Farm Eggs* (`MAT-EGG-01`) | Kache maal ka commercial grade aur item code. |
| **CATEGORY** | `Flours & Grains`, `Sweeteners`, `Dairy & Fats` | Material group tag. |
| **REQUIRED FOR PLAN** | `Advisory Pending` | Baking schedule ke tamam batches ke liye darkar kul wazan ($\sum \text{Finished Products} \times \text{Recipe Grams}$). |
| **WAREHOUSE STOCK** | `Advisory Pending` | Central store / godown mein maujood physical bori / kartan ki ginti. |
| **NET SHORTFALL** | `Advisory Pending` | Khareedari ki darkar miqdaar ($\text{Required} - \text{Warehouse Stock}$). |
| **UNIT RATE (PKR)** | **`Rs 135.00`** (Maida per KG)<br>**`Rs 155.00`** (Sugar per KG)<br>**`Rs 680.00`** (Ghee per KG)<br>**`Rs 360.00`** (Eggs per Dozen) | Pakistani commercial wholesale mandi ke live market rates. |
| **TOTAL COST** | `Advisory Pending` | Estimated khareedari lagat in PKR ($\text{Net Shortfall} \times \text{Unit Rate}$). |
| **APPROVED SUPPLIER** | *Punjab Flour Mills Ltd*<br>*Fauji Sugar Mills*<br>*Dalda Foods Industrial*<br>*SB Poultry Farms* | Quality-certified Pakistani suppliers jinke sath contracted rates tay shuda hain. |
| **STATUS** | `Advisory / Integration Pending` (Amber badge) | Procurement stage. |
| **ACTION** | `Advisory Prototype` | Material workflow indicator. |

---

## 11. Technical Architecture Summary (Under the Hood)

```
[ User Browser / Chart.js Frontend ]
               |  (HTTP REST JSON / Bearer & Headers)
               v
[ Node.js + TypeScript Express ERP Core ] (Port 3000)
    |--- Branch Authorization Middleware
    |--- 35-Day Horizon Guardrail (<=35 days)
    |--- Circuit Breaker State Machine (5 fails in 30s -> OPEN)
    |--- AC-4 Deterministic 4-Week Fallback Engine
    |
    +-----> [ Python 3.12 FastAPI ML Service ] (Port 8000)
    |           |--- LightGBM Multi-Quantile Regressor (P10, P50, P90)
    |           |--- SARIMAX Baseline Model
    |           +--- Feature Parity Engine (Lags, Lunar Calendar, Weather)
    |
    +-----> [ PostgreSQL 16 Database ] (Port 5432)
                |--- Schema `public`: Branches, Products, POS Invoices, Stock
                +--- Schema `ml`: Calendar Dimension, Weather Feed, Daily Demand, Predictions, Overrides
```

---

## 12. Conclusion
BakeSuite ka frontend sirf aik visual skin nahi hai balkay aik **mission-critical commercial bakery intelligence dashboard** hai. Har aik number, graph aur filter real-time statistical algorithms, Pakistani regional dynamics aur robust fallback guardrails ke sath chalta hai.


