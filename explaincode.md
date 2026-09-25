# BakeSuite — Complete Project Codebase File-by-File Summary (`explaincode.md`)

Yeh document BakeSuite project ki har aik file ka **short, crisp, aur to-the-point summary** provide karta hai taake code ka maqsad aur usmein istemal shuda technologies foran samajh aa sakein.

---

## 1. Python ML Microservice (`apps/ml-service/`)

### `apps/ml-service/main.py`
* **Work / Maqsad:** Python FastAPI application ka main entry point hai jo ML service ko boot karta hai, CORS configure karta hai, aur API routes register karta hai.
* **Used / Tech:** `FastAPI`, `CORSMiddleware`, Uvicorn ASGI server, `health_router`, `forecast_router`.

### `apps/ml-service/config.py`
* **Work / Maqsad:** ML service ke environment variables aur configurations ko load aur validate karta hai (DB credentials, Redis host, model paths, ports).
* **Used / Tech:** `pydantic-settings`, `BaseSettings`, OS environment reading.

### `apps/ml-service/requirements.txt`
* **Work / Maqsad:** ML microservice ke تمام Python packages aur unke exact versions define karta hai.
* **Used / Tech:** `fastapi`, `uvicorn`, `lightgbm`, `statsmodels`, `scikit-learn`, `psycopg2-binary`, `redis`, `numpy`, `pandas`, `pytest`.

### `apps/ml-service/Dockerfile`
* **Work / Maqsad:** ML service ko containerize karne ke liye lightweight Python 3.12 Docker image build karta hai.
* **Used / Tech:** `python:3.12-slim`, multi-stage builds, port 8000 exposure.

### `apps/ml-service/.env.example`
* **Work / Maqsad:** ML service ke required environment variables ka sample template provide karta hai.

---

### ML API Endpoints (`apps/ml-service/app/api/`)

### `apps/ml-service/app/api/health.py`
* **Work / Maqsad:** Liveness aur readiness health-check endpoints provide karta hai jo DB aur Redis connectivity report karte hain.
* **Used / Tech:** `APIRouter`, `/health`, `/ready`, psycopg2 connection ping, Redis ping.

### `apps/ml-service/app/api/forecast.py`
* **Work / Maqsad:** Demand forecasting ke API endpoints expose karta hai: single-item inference, batch scoring, aur on-demand rescoring.
* **Used / Tech:** `APIRouter`, Pydantic request/response schemas, `BatchScorer`, `FeatureParityService`.

---

### Core Data & Cache (`apps/ml-service/app/core/`)

### `apps/ml-service/app/core/db.py`
* **Work / Maqsad:** PostgreSQL 16 database ke connection pools banata hai aur queries execute karne ke helper functions deta hai.
* **Used / Tech:** `psycopg2.pool.ThreadedConnectionPool`, context manager `get_db_connection()`.

### `apps/ml-service/app/core/cache.py`
* **Work / Maqsad:** Redis caching layer manage karta hai taake frequent predictions instant serve hon.
* **Used / Tech:** `redis.Redis`, key-value caching, TTL expiration (15 minutes).

---

### Feature Engineering (`apps/ml-service/app/features/`)

### `apps/ml-service/app/features/feature_extractor.py`
* **Work / Maqsad:** Raw transaction sales se machine learning features extract karta hai: lags (7, 14, 21, 28 days), rolling averages, seasonal cyclical encoding (sin/cos of day of year), aur Hijri lunar flags.
* **Used / Tech:** `pandas`, `numpy`, cyclical feature math, lag shifting.

---

### Machine Learning Models (`apps/ml-service/app/models/`)

### `apps/ml-service/app/models/lgbm_quantiles.py`
* **Work / Maqsad:** Main production model hai jo LightGBM Quantile Regression ke 3 separate models train/predict karta hai: P10 (alpha=0.1), P50 (alpha=0.5), P90 (alpha=0.9). Quantile crossing guardrail enforce karta hai ($P10 \le P50 \le P90$).
* **Used / Tech:** `lightgbm.LGBMRegressor(objective='quantile')`, `joblib`, pinball loss evaluation.

### `apps/ml-service/app/models/sarimax_baseline.py`
* **Work / Maqsad:** Statistical baseline model jo time-series seasonality aur exogenous calendar variables (Ramadan, weekends) ko model karta hai.
* **Used / Tech:** `statsmodels.tsa.statespace.sarimax.SARIMAX`.

### `apps/ml-service/app/models/baseline_fallback.py`
* **Work / Maqsad:** Statistical fallback engine jo zero ML dependency ke sath pichlay 4 hafton ke same-weekday demand medians nikalta hai.
* **Used / Tech:** Pure statistical median calculation, zero model drift.

### `apps/ml-service/app/models/cold_start.py`
* **Work / Maqsad:** Naye products (New SKUs) jinki sales history nahi hoti, unke liye category-level hierarchical pooling se forecast banata hai.
* **Used / Tech:** Category aggregation, Bayesian shrinkage priors.

### `apps/ml-service/app/models/confidence.py`
* **Work / Maqsad:** Har prediction ke sath 0% se 100% ka statistical confidence score generate karta hai (data density, historical variance, aur prediction interval width ki base par).
* **Used / Tech:** Prediction interval ratio formula: $1 - \frac{P90 - P10}{P50 \times 2}$.

### `apps/ml-service/app/models/ensemble.py`
* **Work / Maqsad:** LightGBM aur SARIMAX predictions ko blend karke optimal ensemble output banata hai.
* **Used / Tech:** Weighted quantile combination.

### `apps/ml-service/app/models/hurdle_intermittent.py`
* **Work / Maqsad:** Intermittent (kabhi bikne wale) items ke liye Croston / Two-stage Hurdle model chalata hai (Pehla stage: bikne ka probability; Dusra stage: quantity).
* **Used / Tech:** Logistic regression + Zero-inflated Poisson/Gamma regressor.

### `apps/ml-service/app/models/registry.py`
* **Work / Maqsad:** Trained models ke binary artifact files (`.pkl`) ko disk se load, cache, aur version control karta hai.
* **Used / Tech:** `joblib.load()`, singleton model cache.

---

### ML Services & Serving (`apps/ml-service/app/services/` & `serving/`)

### `apps/ml-service/app/services/feature_parity.py`
* **Work / Maqsad:** Ensure karta hai ke training time ke features aur online inference time ke features mein 100% mathematical parity ho (No data leakage).
* **Used / Tech:** Strict schema validator, calendar feature alignment.

### `apps/ml-service/app/services/drift_monitoring.py`
* **Work / Maqsad:** Population Stability Index (PSI) aur Kolmogorov-Smirnov (KS) test se feature drift aur concept drift detect karta hai.
* **Used / Tech:** `scipy.stats.ks_2samp`, PSI formula calculation.

### `apps/ml-service/app/services/retraining_trigger.py`
* **Work / Maqsad:** Agar drift threshold cross ho ya naya data aayee to automatic retraining trigger karta hai.
* **Used / Tech:** Background task scheduler, alert webhooks.

### `apps/ml-service/app/serving/batch_scoring.py`
* **Work / Maqsad:** Nightly batch inference engine jo tamam 32 SKUs aur 3 branches ke 35-day forward predictions calculate karke database table `ml.pred_demand_daily` mein bulk insert karta hai.
* **Used / Tech:** Multi-threaded batch scoring, bulk database transaction inserts.

---

### ML Training Pipeline (`apps/ml-service/app/training/`)

### `apps/ml-service/app/training/train_pipeline.py`
* **Work / Maqsad:** Historical demand data uthata hai, features banata hai, LightGBM P10/P50/P90 models ko train karta hai aur artifacts ko `models/` directory mein save karta hai.
* **Used / Tech:** `lightgbm`, TimeSeriesSplit cross-validation, `joblib.dump`.

### `apps/ml-service/app/training/backtest_engine.py`
* **Work / Maqsad:** Expanding window backtesting engine jo Chapter 5 SRS metrics (WAPE, Pinball Loss, Coverage) evaluate karta hai.
* **Used / Tech:** Walk-forward rolling evaluation, quantile loss computation.

---

### ML Automated Test Suites (`apps/ml-service/test_*.py`)

* **`apps/ml-service/test_ac_acceptance.py`**: Acceptance criteria verify karta hai (quantiles order, non-negativity, 35-day limit).
* **`apps/ml-service/test_ai01_corrections.py`**: AI-01 audit issues (feature parity, boundary checks) verify karta hai.
* **`apps/ml-service/test_data_access.py`**: Database connectivity, queries aur data hygiene check karta hai.
* **`apps/ml-service/test_fallback_baseline.py`**: Deterministic 4-week fallback output aur bounds test karta hai.
* **`apps/ml-service/test_health.py`**: FastAPI health endpoints aur HTTP 200 responses test karta hai.
* **`apps/ml-service/test_leakage_validation.py`**: Strict temporal validation test karta hai ke future data training mein leak na ho.
* **`apps/ml-service/test_srs_chapter5_compliance.py`**: Complete SRS Chapter 5 metrics (WAPE $\le 18\%$, Pinball loss, 35-day guardrail) test karta hai.

---

## 2. Node.js & TypeScript ERP Core (`apps/erp-core/`)

### Core Entry & Server (`apps/erp-core/src/`)

### `apps/erp-core/src/index.ts`
* **Work / Maqsad:** Node.js Express server ka boot file hai jo port 3000 par listen karta hai aur graceful shutdown handles karta hai.
* **Used / Tech:** `http.createServer`, `app.listen`, process signals (`SIGTERM`, `SIGINT`).

### `apps/erp-core/src/app.ts`
* **Work / Maqsad:** Express app configuration: CORS, JSON parser, static frontend folder serve karna, aur API routes mount karna.
* **Used / Tech:** `express`, `cors`, `path.join`, middleware chaining.

### `apps/erp-core/src/config/index.ts`
* **Work / Maqsad:** ERP core ke environment variables (DB credentials, ML service URL, Circuit breaker settings) load aur export karta hai.
* **Used / Tech:** `dotenv`, strongly typed TypeScript config interface.

### `apps/erp-core/src/db/index.ts`
* **Work / Maqsad:** PostgreSQL 16 database ka connection pool initialize karta hai aur queries execute karta hai.
* **Used / Tech:** `pg.Pool`, query helper functions, error logging.

---

### Authentication & Fallback Middleware (`apps/erp-core/src/auth/` & `fallbacks/`)

### `apps/erp-core/src/auth/authMiddleware.ts`
* **Work / Maqsad:** User authentication aur multi-tenant branch authorization check karta hai (`x-user-id`, `x-branch-id`, role checks) taake koi user doosri branch ka data na chura sake.
* **Used / Tech:** Express Request/Response middleware, role validation.

### `apps/erp-core/src/fallbacks/circuitBreaker.ts`
* **Work / Maqsad:** Martin Fowler Circuit Breaker state machine (CLOSED, OPEN, HALF-OPEN). Agar ML service 30 seconds mein 5 dafa fail ho to circuit OPEN ho jata hai aur traffic fallback par divert ho jati hai.
* **Used / Tech:** State machine pattern, rolling error counters, recovery timer.

### `apps/erp-core/src/fallbacks/demandFallback.ts`
* **Work / Maqsad:** AC-4 deterministic 4-week same-weekday median fallback engine. Agar ML service down ho to bina rukaawat ke database se pichlay 4 hafton ka median nikal kar forecast return karta hai.
* **Used / Tech:** PostgreSQL window functions, median statistics, fallback badge assignment.

---

### ERP Routes & API Endpoints (`apps/erp-core/src/routes/`)

### `apps/erp-core/src/routes/forecasts.ts`
* **Work / Maqsad:** Demand forecast ke tamam endpoints provide karta hai:
  * `GET /api/v1/ai/forecasts/demand`: Multi-SKU forecasts with 35-day horizon guardrail.
  * `GET /api/v1/ai/forecasts/chart-data`: 28-day historical actuals + 14-day forward forecast for Chart.js.
  * `GET /api/v1/ai/forecasts/batch-info`: Latest batch scoring audit status.
* **Used / Tech:** `express.Router`, Circuit breaker proxy to ML, PostgreSQL queries, 35-day guardrail check (`HTTP 422`).

### `apps/erp-core/src/routes/overrides.ts`
* **Work / Maqsad:** Branch managers ke manual forecast overrides ko handle karta hai (Create override with audit trail, revert override).
* **Used / Tech:** `POST /override`, `POST /revert`, database insert into `ml.forecast_overrides`.

### `apps/erp-core/src/routes/extracts.ts`
* **Work / Maqsad:** Downstream ERP modules (WMS, POS, Logistics) ke liye tabular forecast data extracts export karta hai.
* **Used / Tech:** CSV serialization, JSON data dumps.

### `apps/erp-core/src/routes/health.ts`
* **Work / Maqsad:** ERP service ka apna health check endpoint.

---

### Utilities & Verification Tests (`apps/erp-core/src/utils/` & root)

### `apps/erp-core/src/utils/formatters.ts`
* **Work / Maqsad:** Pakistani regional conventions implement karta hai: Currency formatting (`Rs 1,250,000.00`) aur date formatting (`DD-MM-YYYY`).
* **Used / Tech:** `Intl.NumberFormat`, Pakistan locale conventions.

### `apps/erp-core/src/test-verify.ts`
* **Work / Maqsad:** ERP core ke tamam endpoints, database queries, guardrails, aur formatters ko programmatically verify karta hai.
* **Used / Tech:** Integration testing script, assertion suite.

### `apps/erp-core/src/test-circuit-breaker.ts`
* **Work / Maqsad:** Circuit breaker state machine (Closed $\rightarrow$ Open $\rightarrow$ Half-Open) aur AC-4 fallback execution ko simulate aur verify karta hai.

### `apps/erp-core/package.json` & `tsconfig.json`
* **Work / Maqsad:** ERP core ke Node dependencies (`express`, `pg`, `tsx`, `typescript`) aur TypeScript compiler options (`ES2022`, strict mode) define karta hai.

---

## 3. Frontend Client Dashboard (`apps/erp-core/client/`)

### `apps/erp-core/client/index.html`
* **Work / Maqsad:** Pure client application ka structural layout hai: Sidebar, Top Navigation, 4 Modular Views (Workbench, Branch Indent, Central Kitchen, Purchase Requirements), Chart container, Modals aur Toasts.
* **Used / Tech:** Semantic HTML5, FontAwesome icons, Inter & Outfit fonts.

### `apps/erp-core/client/app.js`
* **Work / Maqsad:** Dashboard ka complete client-side brain:
  * API calls with authentication headers.
  * Chart.js initialization & dynamic updates (28 actuals vs 14 forecast).
  * Category filtering & search without bugs.
  * Steppers for indent quantities & CSV export.
  * Override modal & SHAP explainability rendering.
* **Used / Tech:** Vanilla JavaScript (ES6+), `Chart.js`, `fetch API`, DOM manipulation.

### `apps/erp-core/client/style.css`
* **Work / Maqsad:** Dark-mode luxury bakery ERP theme ka master design system: CSS variables, glassmorphic cards, responsive data tables, glow badges, custom scrollbars.
* **Used / Tech:** Pure Vanilla CSS, CSS Grid, Flexbox, Keyframe animations.

---

## 4. Database Setup & Preprocessing Scripts (`scripts/`)

### `scripts/init-db.sql`
* **Work / Maqsad:** PostgreSQL master DDL schema file: `public` schema (branches, products, price lists, pos invoices, stock) aur `ml` schema (calendar dimension, weather, daily demand, predictions, overrides) create karta hai.
* **Used / Tech:** PostgreSQL 16 DDL, Indexes, Foreign keys, UUIDs.

### `scripts/init-db.py`
* **Work / Maqsad:** `init-db.sql` ko Python ke zariye execute karke database schema apply karta hai.
* **Used / Tech:** `psycopg2`, SQL file execution.

### `scripts/calendar_generator.py`
* **Work / Maqsad:** 5-year Pakistani Hijri Lunar calendar generate karta hai: Gregorian dates ko Islamic dates (Hijri year, month, day), Ramadan fasting flags, aur Eid/Ashura gazetted holidays ke sath map karta hai.
* **Used / Tech:** Hijri conversion algorithms, Pakistani official holidays schedule.

### `scripts/seed_database.py`
* **Work / Maqsad:** Master data generator aur transaction enricher. 3 branches, 32 products, raw transactions, aur historical actual sales (`2016-2017` aur `March-September 2026`) generate karke 40,000+ demand records seed karta hai.
* **Used / Tech:** `psycopg2.extras.execute_values`, bulk insert optimization, statistical seasonality modeling.

### `scripts/validate_data_coverage.py`
* **Work / Maqsad:** Data audit script jo verify karta hai ke database mein tamam 3 branches, 32 SKUs, aur dates ka mukammal coverage maujood hai (zero missing gaps).

### `scripts/evaluate_ai01_metrics.py`
* **Work / Maqsad:** Machine learning models ke تمام SRS Chapter 5 metrics evaluate karta hai: WAPE (Weighted Absolute Percentage Error), P10/P50/P90 Pinball Loss, aur 80% Prediction Interval Coverage.
* **Used / Tech:** Statistical metric evaluation, LightGBM validation.

### `scripts/benchmark_batch_scale.py`
* **Work / Maqsad:** High-scale performance benchmark script jo 32 SKUs $\times$ 35 days (1,120 predictions) ki batch scoring latency measure karta hai ($<5$ seconds benchmark).

---

## 5. Kubernetes & Docker Infrastructure (`k8s/` & Root)

### `k8s/deployment-ml.yaml`
* **Work / Maqsad:** Kubernetes production deployment manifest for ML service (replicas, CPU/memory limits, readiness/liveness probes, environment secrets).
* **Used / Tech:** Kubernetes v1 Pod/Deployment specification.

### `k8s/cronjob-retraining.yaml`
* **Work / Maqsad:** Kubernetes CronJob jo har hafte automatic model drift evaluation aur retraining pipeline chalata hai.
* **Used / Tech:** Kubernetes CronJob, Scheduled trigger.

### `docker-compose.yml`
* **Work / Maqsad:** Local multi-container development environment: PostgreSQL 16, Redis 7, ML Service (FastAPI), aur ERP Core (Node.js) ko single command se run karta hai.
* **Used / Tech:** Docker Compose v3.8, health-checks, volumes, port mapping.

### `package.json` (Root)
* **Work / Maqsad:** Root workspace orchestrator jo concurrent services run karne ke scripts provide karta hai:
  * `npm run dev:erp`: Express ERP server start karta hai.
  * `npm run dev:ml`: FastAPI ML service start karta hai.
  * `npm run test:erp`: ERP verification suite run karta hai.
  * `npm run test:ml`: Python pytest suite run karta hai.

---

## 6. Project Knowledge & Documentation

### `DEVELOPER.md`
* **Work / Maqsad:** Developer handoff guide: Local installation steps, API specifications, ML formulas, circuit breaker architecture, aur troubleshooting guidelines.

### `brain.md`
* **Work / Maqsad:** Frontend screens aur business process master guide in Roman Urdu (Forecast Workbench, Branch Indent Plan, Central Kitchen Bake Plan, Purchase Requirements, Visual KPIs, Chart.js dynamics).

### `explaincode.md` (Yeh File)
* **Work / Maqsad:** Pure project ki har aik file ka short, to-the-point summary aur technology stack reference.
