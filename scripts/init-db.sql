-- BakeSuite Database Initialization Script for Docker / PostgreSQL Bootstrap
-- Creates transactional ERP schema ('public') and ML feature & model schema ('ml')

CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS ml;

-- 1. Public Schema: Branches & Catalog
CREATE TABLE IF NOT EXISTS public.branches (
    branch_id VARCHAR(32) PRIMARY KEY,
    branch_name VARCHAR(128) NOT NULL,
    city VARCHAR(64) NOT NULL,
    area_type VARCHAR(64) NOT NULL,
    opening_hours VARCHAR(32) NOT NULL,
    open_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.products (
    sku_id VARCHAR(32) PRIMARY KEY,
    sku_name VARCHAR(128) NOT NULL,
    category_id VARCHAR(32) NOT NULL,
    shelf_life_hours INT NOT NULL,
    base_price NUMERIC(10,2) NOT NULL,
    launch_date DATE NOT NULL DEFAULT '2023-01-01',
    status VARCHAR(16) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.price_lists (
    id SERIAL PRIMARY KEY,
    sku_id VARCHAR(32) REFERENCES public.products(sku_id),
    branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
    effective_price NUMERIC(10,2) NOT NULL,
    effective_from DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.promotions (
    promotion_id VARCHAR(64) PRIMARY KEY,
    sku_id VARCHAR(32) REFERENCES public.products(sku_id),
    branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
    discount_percent NUMERIC(5,2) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    promotion_type VARCHAR(32) DEFAULT 'PERCENTAGE_DISCOUNT',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
    redemption_id BIGSERIAL PRIMARY KEY,
    promotion_id VARCHAR(64) REFERENCES public.promotions(promotion_id),
    sku_id VARCHAR(32) REFERENCES public.products(sku_id),
    branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
    redemption_date DATE NOT NULL,
    quantity_redeemed INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.stock_movements (
    movement_id BIGSERIAL PRIMARY KEY,
    sku_id VARCHAR(32) REFERENCES public.products(sku_id),
    branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
    movement_date DATE NOT NULL,
    on_hand_close INT NOT NULL,
    stockout_minutes INT NOT NULL DEFAULT 0,
    partial_day_flag BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.waste_records (
    waste_id BIGSERIAL PRIMARY KEY,
    sku_id VARCHAR(32) REFERENCES public.products(sku_id),
    branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
    waste_date DATE NOT NULL,
    waste_quantity INT NOT NULL,
    reason_code VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.pos_invoices (
    invoice_id VARCHAR(64) PRIMARY KEY,
    branch_id VARCHAR(32) REFERENCES public.branches(branch_id),
    business_date DATE NOT NULL,
    invoice_timestamp TIMESTAMPTZ NOT NULL,
    channel VARCHAR(32) NOT NULL,
    total_net_amount NUMERIC(12,2) NOT NULL,
    total_discount_amount NUMERIC(12,2) NOT NULL,
    payment_method VARCHAR(32) NOT NULL,
    void_flag BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.pos_invoice_lines (
    line_id BIGSERIAL PRIMARY KEY,
    invoice_id VARCHAR(64) REFERENCES public.pos_invoices(invoice_id),
    sku_id VARCHAR(32) REFERENCES public.products(sku_id),
    quantity INT NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    net_amount NUMERIC(12,2) NOT NULL,
    discount_amount NUMERIC(12,2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.forecast_overrides (
    override_id BIGSERIAL PRIMARY KEY,
    sku_id VARCHAR(32) NOT NULL REFERENCES public.products(sku_id),
    branch_id VARCHAR(32) NOT NULL REFERENCES public.branches(branch_id),
    forecast_date DATE NOT NULL,
    original_forecast INT NOT NULL,
    override_quantity INT NOT NULL,
    reason_code VARCHAR(64) NOT NULL,
    notes TEXT,
    user_id VARCHAR(64) NOT NULL,
    model_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_forecast_overrides_lookup 
    ON public.forecast_overrides (branch_id, sku_id, forecast_date);

-- 2. ML Schema: Features, Calendar, Predictions, and Registry
CREATE TABLE IF NOT EXISTS ml.weather_daily (
    branch_city VARCHAR(64) NOT NULL,
    weather_date DATE NOT NULL,
    max_temp_c NUMERIC(4,1) NOT NULL,
    rainfall_mm NUMERIC(5,1) NOT NULL DEFAULT 0.0,
    humidity_percent NUMERIC(4,1) NOT NULL,
    heat_wave_flag BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (branch_city, weather_date)
);

CREATE TABLE IF NOT EXISTS ml.fg_calendar_day (
    gregorian_date DATE PRIMARY KEY,
    hijri_date VARCHAR(32) NOT NULL,
    hijri_year INT NOT NULL,
    hijri_month INT NOT NULL,
    hijri_day INT NOT NULL,
    event_name VARCHAR(64) NOT NULL,
    holiday_flag BOOLEAN NOT NULL,
    ramadan_flag BOOLEAN NOT NULL,
    ramadan_day_index INT NOT NULL,
    last_ten_nights_flag BOOLEAN NOT NULL,
    chand_raat_flag BOOLEAN NOT NULL,
    days_to_eid_ul_fitr INT NOT NULL,
    days_to_eid_ul_adha INT NOT NULL,
    muharram_flag BOOLEAN NOT NULL,
    ashura_flag BOOLEAN NOT NULL,
    salary_week_flag BOOLEAN NOT NULL,
    day_of_week INT NOT NULL,
    is_weekend_spike BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS ml.daily_demand_base (
    sku_id VARCHAR(32) NOT NULL,
    branch_id VARCHAR(32) NOT NULL,
    business_date DATE NOT NULL,
    total_quantity INT NOT NULL,
    total_sales_pkr NUMERIC(12,2) NOT NULL,
    transaction_count INT NOT NULL,
    morning_qty INT DEFAULT 0,
    afternoon_qty INT DEFAULT 0,
    evening_qty INT DEFAULT 0,
    night_qty INT DEFAULT 0,
    stockout_censored_flag BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (sku_id, branch_id, business_date)
);

CREATE TABLE IF NOT EXISTS ml.pred_demand_daily (
    id BIGSERIAL PRIMARY KEY,
    run_id VARCHAR(64) NOT NULL,
    sku_id VARCHAR(32) NOT NULL,
    branch_id VARCHAR(32) NOT NULL,
    forecast_date DATE NOT NULL,
    p10_quantity INT NOT NULL,
    p50_quantity INT NOT NULL,
    p90_quantity INT NOT NULL,
    unit_of_measure VARCHAR(16) DEFAULT 'PCS',
    expected_revenue_pkr NUMERIC(12,2) NOT NULL,
    confidence_score NUMERIC(4,3) NOT NULL,
    confidence_band VARCHAR(16) NOT NULL,
    model_version VARCHAR(32) NOT NULL,
    feature_date DATE NOT NULL,
    cold_start_flag BOOLEAN DEFAULT FALSE,
    event_context VARCHAR(64) NOT NULL,
    driver_summary JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (run_id, sku_id, branch_id, forecast_date)
);
CREATE INDEX IF NOT EXISTS idx_pred_demand_query 
    ON ml.pred_demand_daily (branch_id, sku_id, forecast_date);

CREATE TABLE IF NOT EXISTS ml.model_registry (
    model_version VARCHAR(64) PRIMARY KEY,
    model_name VARCHAR(128) NOT NULL,
    stage VARCHAR(32) NOT NULL DEFAULT 'None',
    rollout_stage VARCHAR(32) DEFAULT 'Stage-0',
    training_start DATE NOT NULL,
    training_end DATE NOT NULL,
    git_commit VARCHAR(64) NOT NULL,
    feature_version VARCHAR(32) NOT NULL,
    hyperparameters JSONB NOT NULL,
    evaluation_metrics JSONB NOT NULL,
    model_card JSONB NOT NULL,
    artifact_path VARCHAR(256) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ml.shadow_evaluations (
    id BIGSERIAL PRIMARY KEY,
    eval_date DATE NOT NULL,
    champion_version VARCHAR(64) NOT NULL,
    challenger_version VARCHAR(64) NOT NULL,
    champion_wape NUMERIC(6,4) NOT NULL,
    challenger_wape NUMERIC(6,4) NOT NULL,
    relative_improvement_pct NUMERIC(6,3) NOT NULL,
    observations_count INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ml.model_audit_log (
    id BIGSERIAL PRIMARY KEY,
    model_version VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    from_stage VARCHAR(32),
    to_stage VARCHAR(32),
    trigger_reason TEXT,
    user_id VARCHAR(64) DEFAULT 'system-ml-orchestrator',
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
