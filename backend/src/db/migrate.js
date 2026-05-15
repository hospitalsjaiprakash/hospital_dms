require('dotenv').config();
const db = require('./index');
const logger = require('../utils/logger');

const migrations = [
  {
    name: '001_create_extensions',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "pg_trgm";
    `
  },
  {
    name: '002_create_staff_master',
    sql: `
      CREATE TABLE IF NOT EXISTS staff_master (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(200) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        employee_id VARCHAR(50) UNIQUE NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('pcc', 'hod', 'admin')),
        department VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_staff_email ON staff_master(email);
      CREATE INDEX IF NOT EXISTS idx_staff_employee_id ON staff_master(employee_id);
    `
  },
  {
    name: '003_create_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        staff_id UUID REFERENCES staff_master(id) ON DELETE SET NULL,
        name VARCHAR(200) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        employee_id VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('pcc', 'hod', 'admin')),
        department VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMPTZ,
        login_attempts INTEGER DEFAULT 0,
        locked_until TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    `
  },
  {
    name: '004_create_patients',
    sql: `
      CREATE TABLE IF NOT EXISTS patients (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        uhid VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(200) NOT NULL,
        admission_date DATE NOT NULL,
        discharge_date DATE,
        hospital_status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (hospital_status IN ('active', 'discharged')),
        settlement_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'completed')),
        notes TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_patients_uhid ON patients(uhid);
      CREATE INDEX IF NOT EXISTS idx_patients_name_trgm ON patients USING GIN (name gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_patients_hospital_status ON patients(hospital_status);
      CREATE INDEX IF NOT EXISTS idx_patients_settlement_status ON patients(settlement_status);
      CREATE INDEX IF NOT EXISTS idx_patients_admission_date ON patients(admission_date DESC);
    `
  },
  {
    name: '005_create_documents',
    sql: `
      CREATE TYPE doc_category AS ENUM (
        'id_proof',
        'ayushman_card',
        'admission_photo',
        'prescription',
        'lab_reports',
        'scans',
        'discharge_summary',
        'other'
      );

      CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        file_url TEXT NOT NULL,
        s3_key TEXT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        doc_type doc_category NOT NULL,
        notes TEXT,
        uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        is_deleted BOOLEAN DEFAULT false,
        deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_documents_patient_id ON documents(patient_id) WHERE is_deleted = false;
      CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type) WHERE is_deleted = false;
      CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
      CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);
    `
  },
  {
    name: '006_create_audit_logs',
    sql: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        user_email VARCHAR(255),
        user_role VARCHAR(20),
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id UUID,
        old_values JSONB,
        new_values JSONB,
        ip_address VARCHAR(50),
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);

      -- Audit logs are append-only via row-level security
      ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
    `
  },
  {
    name: '007_create_refresh_tokens',
    sql: `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
    `
  },
  {
    name: '008_create_triggers',
    sql: `
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();

      CREATE TRIGGER trg_patients_updated_at
        BEFORE UPDATE ON patients
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();

      CREATE TRIGGER trg_documents_updated_at
        BEFORE UPDATE ON documents
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();

      -- Enforce: settlement cannot be 'completed' if hospital_status is 'active'
      CREATE OR REPLACE FUNCTION check_settlement_logic()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.settlement_status = 'completed' AND NEW.hospital_status = 'active' THEN
          RAISE EXCEPTION 'Cannot complete settlement while patient is still active (not discharged)';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_patient_settlement_check
        BEFORE INSERT OR UPDATE ON patients
        FOR EACH ROW EXECUTE FUNCTION check_settlement_logic();
    `
  },
  {
    name: '009_create_migrations_table',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  },
  {
    name: '010_drop_users_email_constraint',
    sql: `
      ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
    `
  },
  {
    name: '011_add_plain_password_to_users',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password VARCHAR(255);
    `
  },
  {
    name: '012_drop_patients_mobile_column',
    sql: `
      -- Drop mobile column and its index from patients table
      DROP INDEX IF EXISTS idx_patients_mobile;
      ALTER TABLE patients DROP COLUMN IF EXISTS mobile;
    `
  },
  {
    name: '013_add_settlement_date_and_fix_discharge_date',
    sql: `
      -- Change discharge_date from DATE to TIMESTAMPTZ to store full datetime
      ALTER TABLE patients
        ALTER COLUMN discharge_date TYPE TIMESTAMPTZ
        USING discharge_date::TIMESTAMPTZ;

      -- Add settlement_date column to record when PMJAY was settled
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS settlement_date TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_patients_discharge_date ON patients(discharge_date);
      CREATE INDEX IF NOT EXISTS idx_patients_settlement_date ON patients(settlement_date);
    `
  },
  {
    name: '014_optimize_patients_indexes',
    sql: `
      -- Index to speed up default frontend sorting by newest first
      CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at DESC);
      
      -- Composite indexes for fast filtering + sorting on the dashboard
      CREATE INDEX IF NOT EXISTS idx_patients_status_created ON patients(hospital_status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_patients_settlement_created ON patients(settlement_status, created_at DESC);
    `
  },
  {
    name: '015_add_new_doc_categories',
    sql: `
      ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'pre_op';
      ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'post_op';
      ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'intra_op';
      ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'bedside';
      ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'procedure';
      ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'specimen';
      ALTER TYPE doc_category ADD VALUE IF NOT EXISTS 'dressing';
    `
  },
  {
    name: '016_add_nursing_role',
    sql: `
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('pcc', 'hod', 'admin', 'nursing'));

      ALTER TABLE staff_master DROP CONSTRAINT IF EXISTS staff_master_role_check;
      ALTER TABLE staff_master ADD CONSTRAINT staff_master_role_check CHECK (role IN ('pcc', 'hod', 'admin', 'nursing'));
    `
  },
  {
    name: '017_change_admission_date_to_timestamp',
    sql: `
      ALTER TABLE patients
        ALTER COLUMN admission_date TYPE TIMESTAMPTZ
        USING admission_date::TIMESTAMPTZ;
    `
  }
];

async function runMigrations() {
  logger.info('Starting database migrations...');

  // Ensure migrations table exists first
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  for (const migration of migrations) {
    const existing = await db.query(
      'SELECT id FROM schema_migrations WHERE name = $1',
      [migration.name]
    );

    if (existing.rows.length === 0) {
      await db.withTransaction(async (client) => {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [migration.name]
        );
      });
      logger.info(`Applied migration: ${migration.name}`);
    } else {
      logger.info(`Skipped migration (already applied): ${migration.name}`);
    }
  }

  logger.info('All migrations completed successfully.');
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Migration failed', { error: err.message });
      process.exit(1);
    });
}
