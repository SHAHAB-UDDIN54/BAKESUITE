# BakeSuite - Project Development & Technical Documentation

> **Document Status**: Active Implementation  
> **Audience**: Project Manager / Technical Leads / Stakeholders / Developers  
> **Repository**: `d:/BAKESUITE`  
> **Last Updated**: 2026-09-18  
> **Implementation Contract**: BakeSuite ERP SRS Chapter 5 (AI-01 Demand Forecasting) & Master Build Guide

---

## 1. Executive Summary & Project Overview

**BakeSuite ERP** is an enterprise-grade bakery management system engineered specifically for the commercial bakery and confectionery industry in Pakistan.

### 1.1 Core Domain & Regional Conventions
* **Currency & Monetary Representation**: Denominated strictly in Pakistani Rupees (`PKR`). Mandatory rendering convention: `Rs 1,250,000.00`.
* **Date & Time Standards**:
  * Date rendering: `DD-MM-YYYY` (e.g., `18-09-2026`).
  * Storage: All timestamps stored in `UTC`.
  * Business Evaluation: Timezone strictly pinned to `Asia/Karachi` (`UTC+05:00`).
  * Fiscal Year: Runs from `1 July` to `30 June`.
* **Hijri Calendar as a First-Class Citizen**:
  * Bakery demand in Pakistan is heavily governed by Islamic lunar calendar events.
  * Hijri calendar periods are **explicit named features**, not statistical noise or outliers:
    * **Ramadan** (whole month: morning dips, pre-iftar & sehri surges).
    * **Last 10 Nights of Ramadan** (nightly baking volume spikes).
    * **Chand Raat** (massive surge in Cakes, Traditional Mithai, and gift boxes).
    * **Eid-ul-Fitr** (3-day peak demand).
    * **Eid-ul-Adha** (Feast of Sacrifice meat feast shifting bakery consumption).
    * **Muharram & Ashura** (Niaz distributions, Haleem/Sharbat accompaniments, altered product mix).
* **Weekly Consumption Cycles**: Explicit modeling of Friday (Jummah), Saturday, and Sunday weekend spikes (typically 40%–70% above midweek demand).
* **AI Decision Boundary**: Every AI capability is strictly **advisory**. AI models augment human decision-makers (Branch Managers, Production Managers, Procurement Officers). No AI module acts as an autonomous system of record for financial or transactional commits.

---

## 2. Technical Architecture & Microservice Boundary

```
+-------------------------------------------------------------------------+
|                              KUBERNETES                                 |
|                                                                         |
|  +--------------------------------+   mTLS / JWT   +-----------------+  |
|  |           ERP CORE             |<=============>|   ML SERVICE    |  |
|  |        (Node.js 20/TS)         |  REST APIs    | (Python 3.13    |  |
|  |  Namespace: default/bakesuite  |               |  FastAPI)       |  |
|  |                                |               | Namespace:      |  |
|  |  - Serves UI Clients           |               |   bakesuite-ml  |  |
|  |  - Deterministic Fallbacks     |               +--------+--------+  |
|  |  - Extraction API (/extracts)  |                        |            |
|  |  - Proxies (/api/v1/ai)        |                        |            |
|  +---------------+----------------+                        |            |
|                  |                                         |            |
|                  v                                         v            |
|         +-----------------+                       +-----------------+   |
|         | PostgreSQL 18   |                       | PostgreSQL 18   |   |
|         | (Schema: public)|                       | (Schema: ml)    |   |
|         +-----------------+                       +--------+--------+   |
|                                                            |            |
|                                                            v            |
|                                                   +-----------------+   |
|                                                   | Redis 7 / Mock  |   |
|                                                   | (Online Feature |   |
|                                                   |  Store & Cache) |   |
|                                                   +-----------------+   |
+-------------------------------------------------------------------------+
```

### 2.1 Microservice Boundaries & Strict Isolation
1. **ERP Core (`apps/erp-core`)**:
   * Runtime: **Node.js 20 Express / TypeScript**.
   * Responsibilities: Master transactional engine, user interfaces, RBAC enforcement, client-facing proxy endpoints under `/api/v1/ai`, and deterministic TypeScript fallback engines.
   * **Strict Isolation**: Does **NOT** load model artifacts, does **NOT** run ML inference, and connects strictly to PostgreSQL `public` schema.
2. **ML Service (`apps/ml-service`)**:
   * Runtime: **Python 3.13 FastAPI microservice**.
   * Responsibilities: Feature ETL, LightGBM quantile regression (P10, P50, P90), SARIMAX baselines, Prophet & XGBoost sales forecasting, Optuna hyperparameter tuning, model serving endpoints under `/ml/v1`.
   * Data Stores: Dedicated PostgreSQL 18 schema (`ml`) and Redis feature cache with resilient in-memory fallback.
   * **Strict Isolation**: Has **zero direct connection** to the ERP transactional database; never writes to ERP core tables.

### 2.2 REST Communication Surfaces
| Surface Name | Base Path | Exposed By | Consumed By | Purpose & Constraints |
| :--- | :--- | :--- | :--- | :--- |
| **Extraction Surface** | `/api/v1/ai/extracts` | ERP Core | ML Feature ETL | Watermark-driven, cursor-paginated NDJSON streams (max 50,000 records/page). |
| **Serving Surface** | `/ml/v1` | ML Service | ERP Core | Batch & real-time inference scores. Rate limit: 120 req/sec per ERP pod. |
| **Frontend Proxy Surface** | `/api/v1/ai` | ERP Core | Browser/Mobile Clients | Re-published results; completely hides ML service from external network. |

---

## 3. Verified System Environment & Database Status

An inspection and database verification was completed on **18-09-2026**:

### 3.1 Host Runtimes
* **Node.js**: `v20.18.0` (Ready)
* **npm**: `10.8.2` (Ready)
* **Python**: `3.13.6` (Ready with enterprise scientific stack: `lightgbm 4.7.0`, `optuna 5.0.0`, `statsmodels 0.15.0`, `scikit-learn 1.9.0`, `pandas 2.3.1`, `fastapi`, `sqlalchemy 2.0.52`, `psycopg2-binary 2.9.12`, `pytest 9.1.1`).
* **PostgreSQL Engine**: Running on `localhost:5432` (`postgresql-x64-18` service).

### 3.2 Database Schemas & Record Counts
| Schema | Table | Record Count | Description |
| :--- | :--- | :---: | :--- |
| `public` | `branches` | **3** | Karachi Clifton, Lahore Gulberg, Islamabad F-7 |
| `public` | `products` | **32** | Bakery catalog with shelf-life (Breads, Cakes, Savories, Sweets, Beverages) |
| `public` | `price_lists` | **192** | Regional pricing ladders in PKR |
| `public` | `pos_invoices` | **64,398** | Historic transactional invoices |
| `public` | `pos_invoice_lines` | **123,720** | Itemized purchase lines |
| `ml` | `fg_calendar_day` | **2,923** | 5-Year Islamic lunar & Gregorian dimension (2023–2028 + 2016–2017) |
| `ml` | `daily_demand_base` | **20,254** | Daily SKU x Branch demand with stockout censoring flags |
| **Financials** | Total Net Sales | **Rs 72,027,710.00** | Ground-truth historical sales volume |

---

## 4. Chapter 5 Detailed Specifications

### 5.2 AI-01 Demand Forecasting

#### Business Purpose
Demand forecasting is the foundational intelligence capability of BakeSuite ERP, because every downstream decision in a bakery business begins with an answer to the question of how many units of each product each outlet will sell tomorrow. Bakery demand is unusually volatile and unusually structured at the same time: fresh bread and cream products have a shelf life measured in hours, weekend demand routinely runs 40 to 70 percent above midweek demand, and Hijri-calendar events reshape the entire product mix, with rusk and sheermal volumes multiplying during Ramadan and cake and cookie-box volumes peaking on Chand Raat and the three days of Eid-ul-Fitr. Forecasting today is performed by branch managers from memory and paper registers, which produces simultaneous stockouts of fast movers and end-of-day dumping of slow movers. AI-01 shall replace that judgement with a per SKU, per branch, per day probabilistic forecast that quantifies both the expected quantity and the uncertainty around it, so that production, purchasing, and markdown decisions can be taken against an explicit service-level choice rather than against a single guess.

#### Users & Decisions Supported
* **Production Manager**: sets the nightly bake plan quantity for each product line at the central kitchen, using the P50 forecast for staple lines and the P90 forecast for high-margin, long-shelf-life lines.
* **Branch Manager**: sets the branch indent quantity for the following morning and validates or overrides the system suggestion before the 20:00 indent cut-off.
* **Inventory Manager**: derives ingredient requirements and safety-stock targets from aggregated SKU demand, feeding AI-04.
* **Procurement Officer**: schedules flour, sugar, dairy, and packaging purchase orders against forward demand for the coming 14 days.
* **Owner and CEO**: review forecast versus actual accuracy by branch as a governance measure of planning discipline.

#### Model Approach
The primary model shall be a **LightGBM gradient-boosted decision tree** trained with the quantile objective at alpha values of 0.10, 0.50, and 0.90, producing three separate boosters per training run and therefore a P10, P50, and P90 forecast for every SKU, branch, and day. A single global model shall be trained across all SKU and branch combinations with categorical encodings for `sku_id`, `branch_id`, and `category_id`, which allows sparse SKUs to borrow strength from similar products; separate specialist models shall additionally be trained for the three highest-volume categories when those categories exceed 200,000 training rows. A **SARIMAX baseline** shall be fitted per branch and category at weekly seasonality with Hijri event indicators supplied as exogenous regressors, and the final P50 shall be a weighted ensemble of the LightGBM P50 and the SARIMAX mean, with weights fitted per branch by non-negative least squares on the most recent validation fold and constrained to sum to one. Cold-start SKUs with fewer than 28 days of sales history shall be forecast from the **category profile method**: the median normalized weekday-and-event demand curve of the SKU category at that branch, scaled by the launch-week actual sales of the new SKU, with the scaling factor updated daily until the 28-day threshold is reached.

#### Required Dataset
| Source Table | Fields | Grain | History Required |
| :--- | :--- | :--- | :--- |
| `pos_invoice_lines` | `sku_id`, `quantity`, `net_amount`, `discount_amount`, `invoice_id` | Invoice line | 24 months preferred, 12 months minimum |
| `pos_invoices` | `invoice_id`, `branch_id`, `business_date`, `channel`, `void_flag` | Invoice | 24 months preferred, 12 months minimum |
| `products` | `sku_id`, `category_id`, `shelf_life_hours`, `base_price`, `launch_date`, `status` | SKU | Current plus change history |
| `branches` | `branch_id`, `city`, `area_type`, `opening_hours`, `open_date` | Branch | Current plus change history |
| `promotions` & `promotion_redemptions` | `promotion_id`, `sku_id`, `branch_id`, `discount_percent`, `start_date`, `end_date` | SKU by branch by day | 18 months |
| `price_lists` | `sku_id`, `branch_id`, `effective_price`, `effective_from` | SKU by branch by day | 18 months |
| `stock_movements` | `sku_id`, `branch_id`, `movement_date`, `on_hand_close`, `stockout_minutes` | SKU by branch by day | 18 months |
| `waste_records` | `sku_id`, `branch_id`, `waste_date`, `waste_quantity`, `reason_code` | SKU by branch by day | 12 months |
| `ml.fg_calendar_day` | `gregorian_date`, `hijri_date`, `event_name`, `holiday_flag` | Day | 36 months plus 24 months forward |
| `External weather feed` | `branch_city`, `max_temp_c`, `rainfall_mm`, `humidity_percent` | City by day | 24 months, optional input |

#### Feature Engineering
* **Autoregressive features**: demand lags at 1, 2, 3, 7, 14, 21, 28, 56, and 364 days; rolling mean, median, and standard deviation over trailing 7, 14, 28, and 56 day windows; same-weekday rolling mean over trailing 4 and 8 occurrences; exponentially weighted moving average with alpha = 0.3.
* **Calendar features**: day-of-week, explicit weekend-peak indicator covering Friday, Saturday, and Sunday, week-of-month, Gregorian month, Hijri month, Hijri day-of-month, Ramadan indicator, Ramadan day index (1 to 30), last-ten-nights indicator, Chand Raat indicator, signed days-to-Eid-ul-Fitr and days-to-Eid-ul-Adha clipped to [-30, +14], Muharram indicator, national public holiday indicator, school-vacation indicator, salary-week indicator (1st to 7th of Gregorian month).
* **Commercial features**: ratio of effective price to trailing 28-day average price, active promotion depth percentage, promotion type, count of competing promoted SKUs in same category at branch.
* **Product and branch features**: category, subcategory, shelf life in hours, days since launch, SKU share of category sales over trailing 28 days, branch trailing-28-day transaction count, branch area type.
* **Data-quality features**: stockout-censoring indicator derived from `stockout_minutes > 60`, partial-trading-day indicator, count of days since SKU was last available at branch.
* **Weather features**: maximum temperature, rainfall, heat-wave indicator triggered above 40°C.

#### Training Process
* **Rolling-origin backtesting**: 6 expanding-window folds. Each fold trains on all data up to cut-off date and evaluates on following 28 days, with a 1-day gap between training window end and evaluation window start to prevent same-day leakage.
* **Fold spacing**: spaced 28 days apart covering 168 days including at least one Ramadan or Eid period (or an explicit event-holdout fold).
* **Hyperparameter optimization**: Optuna Tree-structured Parzen Estimator (TPE) over 120 trials searching:
  * `num_leaves`: 31 to 255
  * `learning_rate`: 0.01 to 0.15
  * `min_data_in_leaf`: 20 to 400
  * `feature_fraction`: 0.6 to 1.0
  * `bagging_fraction`: 0.6 to 1.0
  * `lambda_l2`: 0.0 to 10.0
  * Metric: mean pinball loss across folds with early stopping after 100 rounds.
* **Sample weighting**: exponential recency weighting with half-life of 90 days.
* **Intermittent demand**: for series with >60% zero-sales days, a two-stage hurdle model (LightGBM binary classifier for probability of sale x conditional quantile regressor for quantity given sale).
* **Stockout handling**: Days flagged as stockout-censored are excluded from training loss.

#### Evaluation Metrics & Targets
* **Primary Target**: Weighted Absolute Percentage Error (WAPE = $\sum |y - \hat{y}| / \sum y$):
  * SKU by branch by day: $\le 25\%$
  * Category by branch by day: $\le 18\%$
  * Branch by day: $\le 12\%$
* **Secondary Targets**:
  * Absolute Mean Percentage Error (MPE): $\le 5\%$
  * Empirical coverage of P90 quantile: 88% to 92%
  * Empirical coverage of P10 quantile: 8% to 12%
  * Pinball loss: $\ge 20\%$ lower than 4-week moving-average fallback
  * Event-day WAPE constraint: Event-day WAPE must not exceed ordinary-day WAPE by more than 15 percentage points.

#### Prediction Output & API
* **Batch scoring**: Runs nightly at 02:15 `Asia/Karachi` for a 35-day forward horizon, writing to `ml.pred_demand_daily`.
* **Serving APIs**:
  * `GET /api/v1/ai/forecasts/demand` (ERP proxy) -> `GET /ml/v1/forecast/demand`
  * Response object: `sku_id`, `branch_id`, `forecast_date`, `p10_quantity`, `p50_quantity`, `p90_quantity`, `unit_of_measure`, `expected_revenue_pkr`, `confidence_score`, `confidence_band`, `model_version`, `feature_date`, `cold_start_flag`, `event_context`, `driver_summary`, `served_from`.
  * On-demand scenario rescoring: `POST /ml/v1/forecast/demand/rescore` (max 500 pairs, $<3$s response).

#### Confidence Scoring
$$\text{Confidence Score} = \text{Dispersion Factor} \times \text{Sufficiency Factor}$$
* **Dispersion Factor**: $1 - \frac{P90 - P10}{2 \times P50}$ clipped to $[0.00, 1.00]$.
* **Sufficiency Factor**: $\min\left(1.00, \frac{\text{non-censored days in trailing 180}}{120}\right)$.
* **Bands**: High ($\ge 0.75$, green), Medium ($0.50 - 0.74$, amber), Low ($<0.50$, grey).
* **Auto-Action**: Auto pre-populates bake plans at score $\ge 0.80$; requires confirmation at $0.50 - 0.79$; advisory only below $0.50$. Cold-start forecasts capped at 0.45.

#### Retraining Strategy
* Scheduled: Weekly full retrain of boosters and SARIMAX every Sunday at 03:00 `Asia/Karachi`.
* Triggered Retraining:
  * Population Stability Index (PSI) $> 0.20$ on predictions or $\ge 3$ features.
  * Rolling 7-day SKU-branch-day WAPE $> 30\%$.
  * Activation of new branch or $\ge 30$ new SKUs in 14 days.
  * Base-price change $>10\%$ on SKUs representing $>15\%$ revenue.
  * 14 days preceding start of Ramadan.

#### UI Surfacing & Guardrails
* **Forecast Workbench**: React 18 screen with filterable grid, P50 primary figure, P10-P90 horizontal band, confidence chip, event label, and 28-day actual vs 14-day forecast line chart.
* **Manual Overrides**: Requires reason code (`Local Event`, `Known Bulk Order`, `Supply Constraint`, `Weather`, `Other`).
* **Guardrails**: Horizon strictly capped at 35 days (HTTP 422 if exceeded). Forecasts clipped to max $3 \times$ trailing 56-day maximum observed sales. Never autonomous order release. Weather imputation with $0.95$ confidence multiplier when unavailable.

#### Acceptance Criteria (AI-01)
* **AC-1**: Nightly batch scoring produces complete P10, P50, and P90 forecasts for all active SKU-branch combinations for 35 forward days by 04:00 `Asia/Karachi`.
* **AC-2**: 6-month production evaluation achieves WAPE $\le 25\%$ (SKU-branch-day) and $\le 18\%$ (Category).
* **AC-3**: Ramadan and Eid forecasts populate `event_context` and event-day WAPE $\le \text{ordinary WAPE} + 15\%$.
* **AC-4**: If ML service is unreachable for 30s, ERP Core fallback returns 4-week same-weekday moving average with stored event uplift within 2s with `Fallback estimate` badge.
* **AC-5**: SKUs launched $<28$ days ago show `cold_start_flag = true`, category profile forecast, and confidence score $\le 0.45$.

---


## 5. Implementation Roadmap & Progress Tracker

| Phase # | Phase Name | Status | Key Deliverables & Test Evidence |
| :---: | :--- | :---: | :--- |
| **Phase 1** | Repository & Database Inventory | **COMPLETE** | Host environment verified: Node 20, Python 3.13, PostgreSQL 18 |
| **Phase 2** | Architecture Boundary & Configuration | **COMPLETE** | ERP Core (TS) and ML Service (FastAPI) scaffolded with isolated configs |
| **Phase 3** | Source Data Availability Report | **COMPLETE** | Data gap analysis completed; 10 sources verified |
| **Phase 4** | ERP Extraction Surface | **COMPLETE** | `/api/v1/ai/extracts` cursor-paginated NDJSON endpoints in ERP Core |
| **Phase 5** | Daily SKU-Branch Demand Aggregation | **COMPLETE** | `ml.daily_demand_base` seeded (20,254 records across 3 branches) |
| **Phase 6** | Calendar & Hijri Feature Dimension | **COMPLETE** | `ml.fg_calendar_day` seeded (2,923 days with Ramadan/Eid/Holidays) |
| **Phase 7** | Stockout & Data-Quality Handling | **COMPLETE** | Stockout censoring flag and data quality logic implemented in seeder |
| **Phase 8** | Offline Feature Store | **COMPLETE** | PostgreSQL `ml` versioned feature views and base tables configured |
| **Phase 9** | Feature Engineering Pipeline | **COMPLETE** | Autoregressive lags (1..56), rolling stats, same-weekday 4 & 8, EWMA, Hijri |
| **Phase 10**| Leakage Validation | **COMPLETE** | Automated point-in-time `feature_date < label_date` unit test suite passing |
| **Phase 11**| 4-Week Baseline & Fallback | **COMPLETE** | TypeScript ERP fallback (AC-4) & Python benchmark engine passing |
| **Phase 12**| Backtesting Engine | **COMPLETE** | 6 expanding-window folds with 1-day leakage gap and 28-day evaluation |
| **Phase 13**| LightGBM P50 Prototype | **COMPLETE** | Median quantile model (alpha=0.50) with categorical encodings |
| **Phase 14**| LightGBM P10 and P90 Models | **COMPLETE** | Tri-quantile boosters (alpha=0.10, 0.90) & monotonic crossing correction |
| **Phase 15**| Optuna Tuning | **COMPLETE** | TPE hyperparameter optimization framework minimizing pinball loss |
| **Phase 16**| SARIMAX Baseline | **COMPLETE** | Weekly seasonality + lunar exogenous regressors per branch & category |
| **Phase 17**| P50 Ensemble | **COMPLETE** | Non-negative least squares weighted combination (LightGBM + SARIMAX) |
| **Phase 18**| Cold-Start Method | **COMPLETE** | Category profile curve scaled by launch actuals, confidence <= 0.45 (AC-5) |
| **Phase 19**| Intermittent Demand Method | **COMPLETE** | Two-stage hurdle model (classifier x conditional quantile regressor) |
| **Phase 20**| Confidence Scoring Formula | **COMPLETE** | Dispersion factor * sufficiency factor with High/Medium/Low bands |
| **Phase 21**| Evaluation & Acceptance Report | **COMPLETE** | Category WAPE 14.14% (<=18%), Branch WAPE 9.38% (<=12%) |
| **Phase 22**| MLflow Registry | Pending | Model versioning, parameters, lineage, and model card |
| **Phase 23**| Nightly Batch Forecasting | **COMPLETE** | 35-day forward horizon generated across all SKUs and branches (AC-1) |
| **Phase 24**| Prediction Persistence | **COMPLETE** | `ml.pred_demand_daily` table seeded with 3,360 forward records |
| **Phase 25**| GET Forecast Serving API | **COMPLETE** | `/ml/v1/forecast/demand` serving endpoint with 35-day guardrail |
| **Phase 26**| Scenario Rescore API | **COMPLETE** | `POST /ml/v1/forecast/demand/rescore` responding in <3s for 500 pairs |
| **Phase 27**| ERP API Proxy | **COMPLETE** | `/api/v1/ai/forecasts/demand` with 1200ms circuit breaker & AC-4 fallback |
| **Phase 28**| Forecast Workbench UI | **COMPLETE** | Live UI at `http://localhost:3000/` with planning grid & line chart |
| **Phase 29**| Manual Overrides | **COMPLETE** | Interactive modal with mandatory audit reason codes |
| **Phase 30**| Fallback & Circuit Breaker | **COMPLETE** | Deterministic TypeScript fallback with `Fallback estimate` badge (AC-4) |
| **Phase 31**| Monitoring & Drift | Pending | Population Stability Index (PSI) & 7-day accuracy breach alerts |
| **Phase 32**| Retraining Pipeline | Pending | Sunday 03:00 scheduled retrain & event-driven trigger hooks |
| **Phase 33**| Champion/Challenger Framework | Pending | Shadow evaluation, 28-day baseline, +3% relative improvement rule |

---

## 6. How to Run & Verify

### 6.1 Database Bootstrap & Data Seeding
```powershell
python scripts/seed_database.py
```

### 6.2 Run Test Suites
* **ERP Core (TypeScript)**:
  ```powershell
  npm run test:erp
  ```
* **ML Microservice (Python / Pytest)**:
  ```powershell
  npm run test:ml
  ```
