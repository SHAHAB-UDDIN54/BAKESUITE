# BakeSuite — Aasan Zaban Mein Poora Project Guide (`explaincode.md`)

Yeh document BakeSuite project ke tamam sawalat, concepts, folders aur testing rules ko aasan **Roman Urdu aur English** mein step-by-step samjhata hai.

---

## Fihrist (Table of Contents)

1. [Frontend aur Backend Chalane Ki Commands](#1-frontend-aur-backend-chalane-ki-commands)
2. [CORS Error aur Uska Hal (Port 5500 Live Server)](#2-cors-error-aur-uska-hal)
3. [SKU Kya Hota Hai? (Stock Keeping Unit)](#3-sku-kya-hota-hai)
4. [Testing Phase Ke Faislay (Testing Decisions & Rules)](#4-testing-phase-ke-faislay)
5. [Kubernetes aur DevOps Files (`k8s/` Folder)](#5-kubernetes-aur-devops-files-k8s-folder)
6. [`node_modules` Folder Kya Hai?](#6-nodemodules-folder-kya-hai)
7. [`scripts/` Folder Ki Files Ka Kaam](#7-scripts-folder-ki-files-ka-kaam)
8. [`apps/erp-core` Folder (Frontend + Node API)](#8-appserp-core-folder)
9. [`apps/ml-service` Folder (Python AI Microservice)](#9-appsml-service-folder)
10. [`data/` Folder aur Sales Dataset Ka Istemal](#10-data-folder-aur-sales-dataset-ka-istemal)
11. [Tamam Items aur Categories Ki Master List (32 Products)](#11-tamam-items-aur-categories-ki-master-list)
12. [Is Project Mein Docker Kyun Use Hua?](#12-is-project-mein-docker-kyun-use-hua)

---

## 1. Frontend aur Backend Chalane Ki Commands

BakeSuite mein do main systems hain: **ERP Core (Frontend + Node Backend)** aur **ML Service (Python AI Backend)**.

### Tareeqa A: Dono Ko Ek Sath Chalana (Single Command)
Project root folder (`d:\BAKESUITE`) mein yeh command chalayein:
```powershell
npm run dev
```
*Yeh `concurrently` package ke zariye ERP aur ML dono servers ko ek hi terminal window mein color-coded chala deta hai.*

### Tareeqa B: Alag Alag Terminals Mein Chalana (Recommended)
Agar aap chahein ke dono ke logs alag alag terminals mein nazar aayein:

* **Terminal 1 — Frontend UI + ERP Backend API:**
  ```powershell
  npm run dev:erp
  ```
  * **Frontend Web Dashboard:** [http://localhost:3000](http://localhost:3000)
  * **API Health Check:** [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health)

* **Terminal 2 — Python AI / ML Forecast Service:**
  ```powershell
  npm run dev:ml
  ```
  * **ML Service API:** [http://localhost:8000](http://localhost:8000)
  * **Interactive Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
  * **ML Health Check:** [http://localhost:8000/health](http://localhost:8000/health)

---

## 2. CORS Error aur Uska Hal

### Masla (Why it happened):
Jab aapne frontend ko **VS Code Live Server** (Port `5500`: `http://127.0.0.1:5500`) ke zariye khola, to backend ne request block kar di:
```
Error: Origin http://127.0.0.1:5500 not allowed by CORS
```
Kyunke ERP backend sirf `http://localhost:3000` se aane wali requests allow kar raha tha.

### Hal (How it was fixed):
1. **[`apps/erp-core/src/config/index.ts`](file:///d:/BAKESUITE/apps/erp-core/src/config/index.ts)** mein `allowedOrigins` list mein `http://localhost:5500`, `http://127.0.0.1:5500`, `http://localhost:5173`, aur `http://127.0.0.1:5173` add kar diye gaye.
2. **[`apps/erp-core/src/app.ts`](file:///d:/BAKESUITE/apps/erp-core/src/app.ts)** mein regex check lagaya gaya ke development mode mein local computer ke kisi bhi port se request aaye to reject na ho.
3. Express error handler add kiya gaya taake unhandled error se server crash na ho.

---

## 3. SKU Kya Hota Hai?

* **SKU ka full form:** **Stock Keeping Unit**.
* **Aasan Matlab:** Har aik product aur uske size/flavor ka aik **unique identification code**.
* **Kyun zaroori hai?** 
  Agar aap sirf "Bread" likhein ge to system ko nahi pata chalega ke Plain Large Bread hai, Bran Bread hai, ya Sourdough. Har aik ka weight, qeemat, shelf-life aur ingredients alag hote hain, is liye har product ko alag SKU ID di jati hai.

### BakeSuite Ki Misaalein:
* `SKU-BRD-01` = Plain White Bread (Large)
* `SKU-BRD-02` = Bran Bread (Large)
* `SKU-CAK-01` = Belgian Chocolate Fudge Cake
* `SKU-SAV-01` = Chicken Tikka Puff Patties
* `SKU-SWT-01` = Lahori Naankhatai Box
* `SKU-BEV-01` = Special Karak Doodh Patti

---

## 4. Testing Phase Ke Faislay (Testing Decisions & Rules)

Test suites (`npm run test:erp`, `npm run test:ml`, `npm run test:circuit-breaker`) ke dauran verify kiye gaye ahem rules:

### 4.1 Deterministic Fallback Engine (AC-4 Rule)
* **Khatra:** Agar Python ML server down ho jaye to bakery counter band nahi hona chahiye.
* **Faisla:** System khud-b-khud pichle 4 hafton ke same day (e.g. pichle 4 Somwar) ki sales ka average nikaal kar foran backup P10, P50, P90 forecast screen par dikha deta hai.
* **Badge:** Screen par **"Fallback estimate"** ka badge lag jata hai taake manager ko pata rahe ke yeh AI model nahi balke emergency backup hai.

### 4.2 Circuit Breaker (Hifazati Switch)
* **Kyun zaroori hai?** Bar bar crash hone wale ML server par mazeed traffic bhej kar usay mazeed crush na kiya jaye.
* **Faisla:**
  * **CLOSED:** Sab theek hai, normal traffic chal rahi hai.
  * **OPEN:** Agar 30 seconds ke andar **5 dafa lagataar failure** aaye, to breaker trip ho jata hai aur foran Fallback par switch ho jata hai.
  * **HALF-OPEN:** 60 seconds baad breaker 3 requests bhej kar check karta hai. Agar teeno theek chalti hain to wapas CLOSED ho jata hai.

### 4.3 35-Day Horizon Guardrail
* **Faisla:** Bakery items (double roti, cake) fresh banate hain, is liye forecast sirf **maximum 35 days** aage tak allow hai.
* **Test:** Agar koi user 36 ya us se zyada din ka forecast mangta hai, to system foran **HTTP 422 (Unprocessable Content)** error de kar request block kar deta hai.

### 4.4 Quantile Demand Predictions (P10, P50, P90)
* Bakery mein single number prediction nuqsaan deh hoti hai:
  * **P10 (Minimum / Pessimistic):** Din thanda rahe to kam az kam itna bikega.
  * **P50 (Median / Expected):** Normal din ki expected sale (Baking schedule is par banta hai).
  * **P90 (Peak / Optimistic):** Weekend ya tehwaar par rush ho to maximum itna bikega.

### 4.5 Manual Overrides aur Audit Trail
* **Faisla:** Agar qareeb koi shadi ya local event ho to Branch Manager forecast ki quantity barha ya ghata sakta hai.
* **Rule:** Manager ko **Reason Code** dena laazmi hai. Database mein pura record save hota hai ke kis user ne kis waqt kya change kiya. Chahein to aik click par wapas original AI forecast par revert bhi kar sakte hain.

### 4.6 Branch Authorization Security
* **Faisla:** Karachi branch ka manager sirf Karachi (`BR-KHI-01`) ka data dekh sakta hai. Lahore (`BR-LHR-01`) ya Islamabad ka data chheerne par foran **HTTP 403 Forbidden** aayega.

### 4.7 Rescore Batch Limit (500 Items)
* **Faisla:** Dashboard se aik waqt mein maximum **500 items** re-calculate karne ki ijazat hai. 501 items bhejte hi request reject ho jati hai taake server hang na ho.

### 4.8 Pakistani Hijri Calendar & Weather Factors
* Model mein Pakistani tehwaar factor in hain:
  * **Ramadan:** Sehri aur Iftar timing, din ki sale low, raat ki high.
  * **Eid-ul-Fitr & Eid-ul-Adha:** Cakes aur Sheermal ki demand 300% barh jana.
  * **14 August & Shab-e-Barat:** Mithai aur confectionery ki peak.
  * **Sunday Morning:** Halwa puri, rusk, aur doodh patti ka breakfast rush.
  * **Mausam:** Karachi ki shadeed garmi aur Lahore ki sardi ke mutabiq cold/hot beverage demand.

### 4.9 Data Leakage Prevention
* Model training ke waqt future ka data (aane wale kal ki sales) pichle dinon ke features mein shamil nahi hona chahiye taake model imtihaan mein cheating na kare.

### 4.10 Champion vs Challenger Retraining
* Har Itwar raat **03:00 AM** par model retrain hota hai. Naya model (Challenger) purane model (Champion) ki jagah tabhi lega agar uski accuracy (WAPE) **kam az kam 3% behtar** ho.

---

## 5. Kubernetes aur DevOps Files (`k8s/` Folder)

Kubernetes (**K8s**) cloud production servers par containers ko automatically chalane aur scale karne ke liye use hota hai.

| File | Kaam (Work) | Schedule / Timing |
| :--- | :--- | :--- |
| **[`deployment-ml.yaml`](file:///d:/BAKESUITE/k8s/deployment-ml.yaml)** | ML Microservice ke **2 live instances (replicas)** chalata hai taake agar aik crash ho to doosra sambhal le. | 24/7 hamesha live |
| **[`cronjob-nightly-pipeline.yaml`](file:///d:/BAKESUITE/k8s/cronjob-nightly-pipeline.yaml)** | Har raat agle 35 dinon ka forecast calculate karke database mein load karta hai. | Har raat **01:30 AM** |
| **[`cronjob-retraining.yaml`](file:///d:/BAKESUITE/k8s/cronjob-retraining.yaml)** | AI model ko naye data ke sath retrain karta hai. | Har Itwar **03:00 AM** |

---

## 6. `node_modules` Folder Kya Hai?

* **Matlab:** Tamam external JavaScript/TypeScript packages ka store room.
* **Kyun zaroori hai?** Jab hum `npm install` chalate hain to Express, CORS, PostgreSQL client (`pg`), TypeScript compiler, aur Zod jese packages is folder mein download hote hain.
* **Rules:**
  * Iska size bara hota hai (200MB–500MB+).
  * Isay `.gitignore` mein rakha jata hai taake Git/GitHub par upload na ho.
  * Agar delete ho jaye to terminal mein `npm install` chalane se wapas aa jata hai.

---

## 7. `scripts/` Folder Ki Files Ka Kaam

Setup, data preparation, aur verification ke Python tools:

1. **[`seed_database.py`](file:///d:/BAKESUITE/scripts/seed_database.py):** Database mein 3 branches, 32 products, 125,000+ invoices aur calendar data load karta hai.
2. **[`validate_data_coverage.py`](file:///d:/BAKESUITE/scripts/validate_data_coverage.py):** Audit karta hai ke database mein AI model ke liye zaroori data poora hai ya nahi.
3. **[`calendar_generator.py`](file:///d:/BAKESUITE/scripts/calendar_generator.py):** 5 saal ka Pakistani Hijri + Gregorian calendar dimensions generate karta hai.
4. **[`evaluate_ai01_metrics.py`](file:///d:/BAKESUITE/scripts/evaluate_ai01_metrics.py):** Model ke tamam Chapter 5 metrics (WAPE, MPE, Coverage 80%, Pinball loss) evaluate karta hai.
5. **[`benchmark_batch_scale.py`](file:///d:/BAKESUITE/scripts/benchmark_batch_scale.py):** 3,360 forecasts ki batch generation speed aur latency test karta hai (<2 hours window).
6. **[`run_nightly_pipeline.py`](file:///d:/BAKESUITE/scripts/run_nightly_pipeline.py):** Raat wali automated pipeline ko testing ke liye manually run karta hai.
7. **[`init-db.sql`](file:///d:/BAKESUITE/scripts/init-db.sql) / [`init-db.py`](file:///d:/BAKESUITE/scripts/init-db.py):** PostgreSQL tables aur schemas (`public` aur `ml`) create karta hai.

---

## 8. `apps/erp-core` Folder

Yeh BakeSuite ka **Main Engine** hai jo **Port 3000** par chalta hai:

* **Frontend UI (`apps/erp-core/client/`):**
  * `index.html`: Forecast Workbench dashboard ka structure.
  * `style.css`: Design, themes, aur responsive styling.
  * `app.js`: Interactive data table, Chart.js line charts, branch filters, aur override modal.
* **Backend API (`apps/erp-core/src/`):**
  * `index.ts` / `app.ts`: Express web server jo static files aur REST APIs serve karta hai.
  * `routes/`: Forecasts, manual overrides, extracts, aur health check endpoints.
  * `fallbacks/`: Deterministic 4-week moving average fallback aur Circuit Breaker state machine.
  * `db/`: PostgreSQL connection pool aur queries.
  * `auth/`: JWT security aur branch-level authorization.

---

## 9. `apps/ml-service` Folder

Yeh Python 3.12 aur FastAPI par mushtamil **AI / Machine Learning Microservice** hai jo **Port 8000** par chalta hai:

* **`main.py`:** FastAPI application entrypoint.
* **`app/features/`:** Feature extraction (Lags, rolling averages, lunar calendar, temperature).
* **`app/models/`:** AI Models (LightGBM Quantile Regressors for P10/P50/P90 + SARIMAX).
* **`app/serving/`:** Online real-time serving aur nightly batch scoring.
* **`app/training/`:** Weekly automated model retraining pipeline.
* **`test_*.py`:** 37 automated Pytest unit aur integration tests.

---

## 10. `data/` Folder aur Sales Dataset Ka Istemal

File location: **[`data/raw/bakery_transactions.csv`](file:///d:/BAKESUITE/data/raw/bakery_transactions.csv)**

### Isme Kya Hai?
Is CSV mein bakery counter ki asli receipts ka data hai (`TransactionNo`, `Items`, `DateTime`, `Daypart`, `DayType`, `Quantity`).

### Yeh Project Mein Kahan Use Hota Hai?
1. **`scripts/seed_database.py`:** Is data ko parh kar Pakistani branches (Karachi, Lahore, Islamabad), PKR currency, aur Ramadan/Eid ke dates ke sath enrich karke PostgreSQL database mein **125,334 invoices** bana kar daalta hai.
2. **AI Model Training:** AI model isi historical data se Somwar, Itwar, aur festive patterns seekhta hai.
3. **UI Dashboard Chart:** Browser screen par pichle 28 dinon ki **actual sales ki line** isi data se draw hoti hai.
4. **Fallback Engine:** ML server down hone par pichle 4 hafton ka average isi data se calculate hota hai.

---

## 11. Tamam Items aur Categories Ki Master List

Master file: **[`scripts/seed_database.py`](file:///d:/BAKESUITE/scripts/seed_database.py#L23-L65)**  
BakeSuite mein total **32 Products** hain jo **6 Categories** mein taqseem hain:

### 1. Breads & Traditional Loaves (`BREAD` — 7 Items)
* `SKU-BRD-01`: Plain White Bread | 48 hrs shelf life | Rs 180.00
* `SKU-BRD-02`: Bran Bread | 48 hrs shelf life | Rs 220.00
* `SKU-BRD-03`: Farmhouse Sourdough | 36 hrs shelf life | Rs 260.00
* `SKU-BRD-04`: French Baguette | 24 hrs shelf life | Rs 240.00
* `SKU-BRD-05`: Traditional Sheermal | 72 hrs shelf life | Rs 160.00
* `SKU-BRD-06`: Royal Taftan | 48 hrs shelf life | Rs 150.00
* `SKU-BRD-07`: Garlic Herb Focaccia | 24 hrs shelf life | Rs 320.00

### 2. Cakes (`CAKE` — 2 Items)
* `SKU-CAK-01`: Belgian Chocolate Fudge Cake | 72 hrs shelf life | Rs 1,850.00
* `SKU-CAK-02`: Red Velvet Cream Cheese Cake | 48 hrs shelf life | Rs 1,950.00

### 3. Pastries & Baked Treats (`PASTRY` — 6 Items)
* `SKU-CAK-03`: Classic Black Forest Pastry | 24 hrs shelf life | Rs 250.00
* `SKU-CAK-04`: Walnut Fudge Brownie | 72 hrs shelf life | Rs 320.00
* `SKU-CAK-05`: Blueberry Streusel Muffin | 48 hrs shelf life | Rs 220.00
* `SKU-CAK-06`: English Butter Scone | 36 hrs shelf life | Rs 200.00
* `SKU-CAK-07`: Custard Fruit Tartine | 24 hrs shelf life | Rs 280.00
* `SKU-CAK-08`: Medialuna Croissant | 24 hrs shelf life | Rs 240.00

### 4. Savories & Hot Kitchen (`SAVORY` — 6 Items)
* `SKU-SAV-01`: Chicken Tikka Puff Patties | 12 hrs shelf life | Rs 160.00
* `SKU-SAV-02`: Club Sandwich Platter | 8 hrs shelf life | Rs 480.00
* `SKU-SAV-03`: Spanish Omelette Brunch | 6 hrs shelf life | Rs 650.00
* `SKU-SAV-04`: Spinach & Feta Frittata | 8 hrs shelf life | Rs 520.00
* `SKU-SAV-05`: Cream of Mushroom Soup | 8 hrs shelf life | Rs 380.00
* `SKU-SAV-06`: Spiced Chicken Stew | 8 hrs shelf life | Rs 580.00

### 5. Traditional Confectionery & Biscuits (`SWEET` — 6 Items)
* `SKU-SWT-01`: Lahori Naankhatai Box | 30 days shelf life | Rs 480.00
* `SKU-SWT-02`: Almond Rusk Pack | 30 days shelf life | Rs 280.00
* `SKU-SWT-03`: Gulab Jamun Assortment (1kg) | 4 days shelf life | Rs 1,250.00
* `SKU-SWT-04`: Dulce de Leche Alfajores | 10 days shelf life | Rs 220.00
* `SKU-SWT-05`: Belgian Chocolate Truffles Box | 15 days shelf life | Rs 650.00
* `SKU-SWT-06`: Jammie Butter Biscuits | 30 days shelf life | Rs 180.00

### 6. Hot & Cold Beverages (`BEVERAGE` — 5 Items)
* `SKU-BEV-01`: Special Karak Doodh Patti | 4 hrs shelf life | Rs 180.00
* `SKU-BEV-02`: Espresso Roast Coffee | 4 hrs shelf life | Rs 380.00
* `SKU-BEV-03`: Dark Belgian Hot Chocolate | 4 hrs shelf life | Rs 420.00
* `SKU-BEV-04`: Fresh Seasonal Citrus Juice | 6 hrs shelf life | Rs 280.00
* `SKU-BEV-05`: Greek Yogurt Berry Smoothie | 6 hrs shelf life | Rs 450.00

---

## 12. Is Project Mein Docker Kyun Use Hua?

1. **Polyglot Stack:** Project do alag technologies use karta hai (Node.js 20 + Python 3.12 + C++ LightGBM libraries). Docker dono ko alag isolated containers mein pack karta hai taake computer par koi library conflict na ho.
2. **Same Environment Everywhere:** Windows laptop par chalne wala code jab Linux cloud server par jaye to crash na ho.
3. **Kubernetes (K8s) Requirement:** Kubernetes containers chalane ke liye Docker images (`bakesuite-ml-service:1.0.0` aur `bakesuite-erp-core:1.0.0`) use karta hai.
