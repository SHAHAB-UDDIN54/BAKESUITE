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

## 8. Branch Indent Plan Screen (Module 2 Deep Dive)

Jab user left sidebar se **Branch Indent Plan** par click karta hai, to Store Requisition aur Dispatch Logistics ka view khulta hai (jaisa ke application mein live nazar aa raha hai).

### 8.1 Header & Operational Notice
* **Header Title:** `Branch Indent Plan`
* **Subtitle:** `Branch Daily Store Requisitions & Stock Dispatch Logistics`
* **35-Day Horizon Active & Last Batch Timestamp:** Top right par live ML execution timestamp (`11:27:26 PKT (32 SKUs)`) aur guardrail active rehta hai.
* **Advisory Planning Banner (Blue Box):**
  > ℹ️ **Advisory Planning View:** Requisitions calculated from latest branch stock movements and AI P50 demand. Human review required prior to store dispatch.
  * *Process & Maqsad:* AI probabilistic demand forecast calculate karta hai. Store dispatch se pehle branch manager ka physical inspection aur human sign-off zaroori hota hai taake over-stocking ya shelf-life waste na ho.

---

### 8.2 Filters & Global Action Bar
1. **TARGET BRANCH Dropdown (`BR-KHI-01`, `BR-LHE-01`, `BR-ISB-01`):**
   * *Fully Synchronized:* Dropdown change karte hi system us specific retail branch ka actual machine learning forecast backend se fetch karke poore indent plan ko real-time update kar deta hai.
2. **INDENT STATUS Dropdown (`All Statuses`, `Advisory Review`, `Approved`, `Dispatched`):**
   * Real-time status filter. Agar manager sirf un items ko dekhna chahe jo abhi pending review hain ya jo approve ho chuke hain, to yeh filter foran list ko refine kar deta hai.
3. **FILTER SKU Input (`Search branch items...`):**
   * Real-time search box. Type karte hi matching products (e.g. `Karak`, `Coffee`, `Pastry`) filter ho jaate hain.
4. **Approve All Pending Button (Green — 100% Functional):**
   * Aik click mein تمام 32 SKUs ko bulk approve kar deta hai, tamam status pills green `Approved` ban jaati hain, aur `Pending Approval` KPI zero ho jata hai.
5. **Export Indents (CSV) Button:**
   * Active branch ka complete indent plan formatted CSV spreadsheet file mein download karta hai jismein SKU ID, Name, Category, Safety Threshold, P50 Demand, Suggested Indent, Approved Qty aur Status shamil hote hain.

---

### 8.3 Top 4 KPI Summary Cards (Indent Metrics)
1. **TOTAL INDENT DEMAND (`406 PCS` — Advisory Requisition):**
   * *Formula:* Tamam 32 SKUs ki approved quantities ka live mathematical sum ($\sum \text{Approved Qty}$).
   * Stepper ya number input se kisi bhi item ki quantity change karne par yeh total card foran real-time update hota hai!
2. **PENDING APPROVAL (`32 SKUs` / Decrements live to `0 SKUs`):**
   * Kitne SKUs abhi tak `Advisory Review` stage mein hain. Row approve hone par yeh counter live decrement hota hai.
3. **DISPATCHED TO STORE (`Integration Pending` / `32 Approved`):**
   * Store logistics readiness indicator. Jab items approve hote hain to yeh dynamic approved dispatch count dikhata hai.
4. **STOCKOUT RISK LEVEL (`Advisory Buffer Intact` / `Low Allocations Alert`):**
   * Safety buffer health indicator. Agar kisi item ki approved quantity P50 consumer demand se kam kar di jaye to yeh foran "Low Allocations" alert dikhata hai.

---

### 8.4 Branch Daily Requisitions Grid (Data Table)
Table counter live dynamic rehta hai: `Showing 32 of 32 advisory requisitions`.

| Column Header | Value & Format | Technical Process & Meaning |
| :--- | :--- | :--- |
| **SKU INFORMATION** | *Special Karak Doodh Patti (SKU-BEV-01)* | Commercial name aur unique SKU identifier. |
| **CATEGORY** | `BEVERAGE`, `BREAD`, `CAKE`, etc. | Product category badge. |
| **SHELF STOCK** | `Integration Pending` | Store display shelf aur chiller stock level indicator. |
| **SAFETY MIN** | `+2 PCS (15%)` | 15% safety buffer threshold taake stockout na ho. |
| **AI P50 DEMAND** | **`9 PCS`** | Machine learning quantile booster ka median consumer forecast. |
| **SUGGESTED INDENT** | `11 PCS*` | Recommended replenishment quantity ($\text{P50} + \text{Safety Buffer}$). |
| **APPROVED QTY** | **Interactive Stepper: `[-] [ 11 ] [+]`** | **Dual-Action Control:** User `+`/`-` buttons se 1-unit increment/decrement bhi kar sakta hai aur direct box ke andar apni marzi ka number type bhi kar sakta hai. |
| **STATUS** | `Advisory Review` (Amber) / `Approved` (Green) | Requisition approval workflow stage. |
| **ACTIONS** | **`Approve` $\leftrightarrow$ `Approved ✓` Toggle Button** | Click karne par status `Approved` (green) ho jata hai, dobara click par revert ho sakta hai. |

---

---

## 9. Central Kitchen Bake Plan Screen (Module 3 Deep Dive)

Jab user sidebar se **Central Kitchen Bake** select karta hai, to bakery ke main manufacturing kitchen ke ovens aur rotary rack batch scheduling ka live view khulta hai.

### 9.1 Screen Header & Kitchen Banner
* **Title & Subtitle:** `Central Kitchen Bake Plan — Commercial Deck & Rotary Oven Batch Scheduling (Live Workflow)`
* **Advisory Warning Banner (Amber Box):**
  > ⚠️ **Advisory Prototype View:** Master Recipe/BOM & commercial deck/rotary oven equipment scheduling integration pending. Schedules are advisory planning models.
  * AI demand forecast ko central production kitchen ke ovens aur manufacturing lines ke schedules mein convert karta hai.

---

### 9.2 Filters & Kitchen Controls
1. **BAKING SHIFT Dropdown (`Morning Shift`, `Afternoon Shift`, `Night Shift`):**
   * Shift select karne par KPI timing (`04:00 - 12:00 PKT`, `12:00 - 20:00 PKT`, `20:00 - 04:00 PKT`) update hoti hai.
2. **OVEN / EQUIPMENT Dropdown (`All Stations`, `Deck Oven A`, `Deck Oven B`, `Rotary Rack 1`, `Convection Line 2`):**
   * Filter stations: Specific oven par assign shuda batches filter karne ke liye.
3. **Schedule Emergency Batch Button (Gold — 100% Functional):**
   * Click karte hi live schedule ke top par **`EMERG-01`** batch gold **URGENT** badge ke sath schedule mein inject ho jati hai (Fresh Brioche Buns, 2 batches, Rotary Rack 1), Scheduled Batches count barh jata hai aur capacity meter update ho jata hai.
4. **Print Bake Sheet (CSV) Button:**
   * Kitchen oven operators ke liye printable baking sheet CSV format mein download karta hai.

---

### 9.3 Top 4 KPI Summary Cards (Kitchen Metrics)
1. **SCHEDULED BATCHES (`10 Batches` / Dynamic with Emergency Batches):**
   * Active shift ke doran bakery products ko bake karne ke liye total production batches.
2. **COMMERCIAL OVEN CAPACITY (`60% (Optimum)` / `70% High Load` with Dynamic Meter Fill Bar):**
   * 20 standard batches capacity ke mutabiq live oven utilization percentage aur colored visual progress bar ($0\% - 100\%$).
3. **CURRENT BAKING SHIFT (`Morning Shift` — `04:00 - 12:00 PKT`):**
   * Kitchen timing aur active shift context.
4. **READY FOR STORE DELIVERY (`In Production` $\rightarrow$ `X / 10 Ready`):**
   * Jab batches cooling rack se complete ho kar `Ready` stage par aati hain, yeh counter automatically increment hota hai.

---

### 9.4 Central Kitchen Master Baking Schedule Grid (Data Table)
* **Real Baked Goods Physics:** Tamam non-baked items (e.g. Chai, Coffee, Cold drinks) ko filter out kar diya gaya hai aur sirf authentic baking products (Breads, Cakes, Savories, Traditional Sweets) schedule hote hain.

| Column Header | Value / Range | Technical Process & Baking Physics |
| :--- | :--- | :--- |
| **BATCH CODE** | **`PLAN-101`**, **`EMERG-01` (URGENT)** | Har batch ka unique traceability code. |
| **PRODUCT NAME** | *Plain White Bread*, *Black Forest Gateau*, etc. | Authentic bakery item name aur SKU code. |
| **CATEGORY** | `BREAD`, `CAKE`, `SAVORY`, `SWEET` | Product category tag. |
| **CONSOLIDATED DEMAND** | **`13 PCS`**, **`25 PCS`** | Central kitchen production target. |
| **BATCH SIZE** | `50 / batch` (Breads), `12 / batch` (Cakes), `60 / batch` (Savories) | Single oven tray/deck loading capacity. |
| **BATCHES REQUIRED** | **`1`**, **`2`** | Formula: $\lceil \text{Consolidated Demand} / \text{Batch Size} \rceil$. |
| **ASSIGNED STATION** | `Deck Oven A` (Stone Hearth), `Deck Oven B`, `Rotary Rack 1`, `Convection Line 2` | Commercial equipment jahan item bake hota hai. |
| **TEMP & TIME** | `220°C / 30m`, `175°C / 45m`, `190°C / 25m` | Authentic bakery crust aur crumb texture settings. |
| **CURRENT STAGE** | `Mixing` (Purple) $\rightarrow$ `Proofing` (Gray) $\rightarrow$ `Baking` (Orange) $\rightarrow$ `Cooling` (Blue) $\rightarrow$ `Ready` (Cyan/Green) | Live operational workflow stage. |
| **ACTION** | **Interactive Stage Button (`Proof`, `Bake`, `Cool`, `Ready ✓`)** | Button click karte hi batch agli production stage par chali jaati hai aur status badge color badal jata hai. |

---

---

## 10. Purchase Requirements Screen (Module 4 Deep Dive)

Jab user sidebar se **Purchase Requirements** select karta hai, to finished goods demand ko raw materials (BOM - Bill of Materials) mein convert karne ka **Material Requirements Planning (MRP)** view khulta hai.

### 10.1 Screen Header & Procurement Banner
* **Title & Subtitle:** `Purchase Requirements — Raw Material Explosion & Ingredient Requisitions (Dynamic BOM Explosion)`
* **Advisory Warning Banner (Amber Box):**
  > ⚠️ **Advisory Prototype View:** Central procurement ERP database integration pending. Automatic purchase order creation is disabled.
  * Procurement officers ke liye commercial shopping list calculate karta hai taake certified vendor rates par purchase orders release kiye ja sakein.

---

### 10.2 Filters & Procurement Controls
1. **MATERIAL URGENCY Dropdown (`All Ingredients`, `Critical Shortages Only`, `Reorder Required`, `Adequate Stock`):**
   * *100% Functional Filter:*
     * `Critical Shortages Only`: Sirf un raw materials ko filter karta hai jinki shortfall dangerous level par ho ($>40\%$).
     * `Reorder Required`: Tamam items jinki purchase order darkar hai.
     * `Adequate Stock`: Jinka godown mein stock kafi hai.
2. **Review Purchase Recommendations Button (Gold Outline — 100% Functional):**
   * Click karte hi tamam shortfall raw materials ke draft purchase orders aik click mein release ho jaate hain aur status `PO Drafted` ban jata hai.
3. **Export BOM Requisition (CSV) Button:**
   * Supply chain manager ke liye complete raw material shortfall sheet with Pakistani Mandi wholesale rates CSV format mein download karta hai.

---

### 10.3 Top 4 KPI Summary Cards (Procurement Metrics)
1. **CRITICAL SHORTAGE ITEMS (`4 Critical Items` in Rose Red):**
   * Raw materials jin ka stock production rok sakta hai (e.g. Ghee, Farm Eggs, Belgian Cocoa).
2. **OPEN PURCHASE ORDERS (`0 Open POs` $\rightarrow$ `6 POs Drafted`):**
   * Vendors ke sath kitne purchase orders generate ho chuke hain (live incrementing counter).
3. **EST. REQUISITION VALUE (`Rs 69,850.00` — Live PKR Cost):**
   * Raw materials khareedne ke liye darkar working capital: $\sum (\text{Shortfall Qty} \times \text{Unit Rate PKR})$.
4. **WAREHOUSE SAFETY STOCK (`78% Reserve Safe`):**
   * Central raw material warehouse ka inventory buffer indicator.

---

### 10.4 Raw Material Requisitions & BOM Explosion Grid (Data Table)
Table header kehta hai: `Showing 8 primary baking ingredients`. Tamam columns dynamically calculate hote hain (koi static "Advisory Pending" text nahi hai):

| Column Header | Example Dynamic Values | Commercial Procurement Meaning |
| :--- | :--- | :--- |
| **RAW MATERIAL** | *Fine Maida Flour (Grade A Extra White)* (`MAT-FLR-01`)<br>*Bakery Shortening Ghee / Butterfat* (`MAT-FAT-01`)<br>*Fresh Farm Eggs* (`MAT-EGG-01`) | Raw ingredient name aur commercial code. |
| **CATEGORY** | `Flours & Grains`, `Sweeteners`, `Dairy & Fats`, `Leavening`, `Flavors` | Material group tag. |
| **REQUIRED FOR PLAN** | **`171 KG`**, **`65 KG`**, **`49 Dozens`** | Central kitchen finished goods demand ke mutabiq darkar wazan. |
| **WAREHOUSE STOCK** | **`111 KG`**, **`33 KG`**, **`27 Dozens`** | Central godown mein maujood physical stock. |
| **NET SHORTFALL** | **`60 KG`**, **`32 KG`**, **`22 Dozens`** (Red if shortage, Green if 0) | Khareedari ki darkar miqdaar ($\text{Required} - \text{Stock}$). |
| **UNIT RATE (PKR)** | **`Rs 135.00`**, **`Rs 680.00`**, **`Rs 360.00`** | Pakistani commercial wholesale mandi rates. |
| **TOTAL COST** | **`Rs 8,100.00`**, **`Rs 21,760.00`**, **`Rs 7,920.00`** | Estimated purchase value in PKR ($\text{Shortfall} \times \text{Rate}$). |
| **APPROVED SUPPLIER** | *Punjab Flour Mills Ltd*, *Dalda Foods Industrial*, *SB Poultry Farms* | Contracted quality suppliers. |
| **STATUS** | `Critical Shortage` (Red), `Reorder Required` (Amber), `Adequate Stock` (Green), `PO Drafted` (Cyan) | Dynamic inventory status badge. |
| **ACTION** | **Interactive `Generate PO` $\rightarrow$ `PO Released ✓` Button** | Click karte hi specific material ka Purchase Order `PO-XXXX` generate ho jata hai aur cyan badge ban jata hai. |

---

---

## 11. Recent Upgrades & Functional Bug Fixes Summary

Humne application ko completely bug-free aur production-grade banane ke liye darj-zail core fixes implement kiye hain:

1. **Initial Page Load Rendering Fix:**
   * Pehle direct URL (e.g. `#indent`, `#production`, `#purchase`) par aane se table khali rehti thi. Ab `loadForecastData()` API response aate hi active hash view ko fauran populate kar deta hai.
2. **Branch Synchronization & Forecast Re-fetch:**
   * Indent screen par branch change karne se ERP Core API se us specific branch ka actual probabilistic ML demand fetch hota hai.
3. **Interactive Control Workflows (No Inert Buttons):**
   * *Branch Indent:* Stepper direct number typing + $1/-1$ buttons ke sath chal raha hai; Individual Approve button aur "Approve All Pending" button working hain.
   * *Central Kitchen:* Stage progression button (`Mixing` $\rightarrow$ `Proofing` $\rightarrow$ `Baking` $\rightarrow$ `Cooling` $\rightarrow$ `Ready`) active hai; "Schedule Emergency Batch" real `EMERG-01` batch inject karta hai; Oven capacity meter dynamically fill hota hai.
   * *Purchase Requirements:* Dynamic Bill-of-Materials explosion calculation lagayi gayi hai; Individual "Generate PO" aur Bulk "Review Recommendations" working hain; Urgency dropdown filter 100% accurate hai.
4. **Global Utilities & Cache Busting:**
   * `showToast` utility ko global `window.showToast` banaya gaya taake kisi inline button par silent JavaScript crash na ho.
   * `index.html` mein script tag cache-busting version `app.js?v=1.2.0` ke sath update kiya gaya taake browser hamesha latest code load kare.

---

## 12. Technical Architecture Summary (Under the Hood)

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
    +-----> [ PostgreSQL 18 Database ] (Port 5432)
                |--- Schema `public`: Branches, Products, POS Invoices, Stock
                +--- Schema `ml`: Calendar Dimension, Weather Feed, Daily Demand, Predictions, Overrides
```

---

## 13. Conclusion
BakeSuite ka frontend ab sirf aik visual presentation nahi hai balkay aik **fully integrated, resilient commercial bakery intelligence ERP** hai jismein Forecast Workbench, Branch Indent Plan, Central Kitchen Bake Plan, aur Purchase Requirements aapas mein real mathematical demand aur robust fallback guardrails ke sath chalta hai.


