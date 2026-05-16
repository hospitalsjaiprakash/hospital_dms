# 🏥 Hospital Patient Document Management System

A production-grade, full-stack web application for managing hospital patient documents with role-based access control, secure file storage, and audit logging.

---

## 📋 Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Tailwind CSS, Lucide icons |
| Backend | Node.js, Express.js, PostgreSQL 16 |
| Imaging | OpenCV.js (Scanner), HTML5 Canvas (GPS Stamping) |
| Storage | AWS S3 / Supabase Storage (AES-256) |
| Auth | JWT + bcrypt password hashing |

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- AWS Account with S3 bucket

### 1. Clone & Setup

```bash
# Backend
cd backend
cp .env.example .env
# Edit .env with your DB and AWS credentials
npm install

# Frontend
cd ../frontend
cp .env.example .env
npm install
```

### 2. Setup Database

```bash
cd backend
# Run migrations
npm run migrate

# Seed initial data (admin user + sample patients)
npm run seed
```

### 3. Start Development Servers

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm start
```

### 4. Access the App
- **Frontend**: http://localhost:3000
- **API**: http://localhost:5000/api
- **Health Check**: http://localhost:5000/api/health

---

## 🐳 Docker Deployment

```bash
# Copy and fill environment file
cp .env.example .env

# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f backend
```

---

## 🔐 Default Credentials (After Seed)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@hospital.com | Hospital@123 |
| HOD | hod@hospital.com | Hospital@123 |
| PCC | pcc1@hospital.com | Hospital@123 |

> ⚠️ Change all passwords immediately in production!

---

## 👥 Role Permissions

| Feature | PCC | Nursing | HOD | Admin |
|---------|-----|---------|-----|-------|
| Upload documents | ✅ | ✅ | ✅ | ✅ |
| View all documents | ✅ | ✅ | ✅ | ✅ |
| Edit own uploads | ✅ | ✅ | ✅ | ✅ |
| Delete own uploads | ✅ | ✅ | ✅ | ✅ |
| Edit/Delete Others | ❌ | ❌ | ✅ | ✅ |
| Patient management | Limited | Limited | ✅ | ✅ |
| User management | ❌ | ❌ | ❌ | ✅ |
| View audit logs | ❌ | ❌ | ✅ | ✅ |

---

## 📁 Project Structure

```
hospital-dms/
├── backend/
│   ├── src/
│   │   ├── controllers/     # Request handlers
│   │   ├── middleware/      # Auth, validation
│   │   ├── routes/          # API routes
│   │   ├── services/        # S3, audit log services
│   │   ├── db/              # Pool, migrations, seed
│   │   └── utils/           # Logger, response helpers
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/      # Reusable UI components
│   │   │   ├── documents/   # Document upload component
│   │   │   └── layout/      # App layout & sidebar
│   │   ├── context/         # Auth context
│   │   ├── hooks/           # Custom hooks
│   │   ├── pages/           # All page components
│   │   └── services/        # API service layer
│   ├── Dockerfile
│   └── package.json
└── docker-compose.yml
```

---

## 🏗️ Key Architecture Decisions

### Security
- JWT tokens expire in 8 hours (configurable)
- Account lockout after 5 failed login attempts (15 min)
- Rate limiting: 100 req/15min global, 10 req/15min for auth
- Passwords hashed with bcrypt cost factor 12
- All S3 files encrypted with AES-256
- Helmet.js security headers

### Storage
- Images auto-compressed client-side before upload (browser-image-compression)
- Server-side compression with Sharp as fallback
- Hard limit: 1MB after compression
- Soft delete: files moved to S3 archive/ prefix, not hard deleted
- S3 keys organized: `documents/YYYY/MM/patientId/docType/uuid-filename`
- Pre-signed URLs for secure file viewing (15 min expiry)

### Database
- PostgreSQL connection pooling (min 2, max 20)
- Slow query logging (>1000ms)
- Triggers enforce `updated_at` timestamps
- DB-level constraint: settlement cannot complete if patient is active
- GIN trigram index on patient names for fast fuzzy search
- Audit logs are append-only (RLS enabled)

### API Design
- All responses: `{ success, message, data, timestamp }`
- Paginated responses include: `{ page, limit, total, totalPages, hasNextPage, hasPrevPage }`
- Global error handler with DB error code mapping
- Async errors handled by `express-async-errors`

---

## 📡 API Reference

### Auth
```
POST /api/auth/signup    - Register (email must be in staff_master)
POST /api/auth/login     - Login → returns JWT
GET  /api/auth/me        - Current user profile
```

### Patients
```
GET    /api/patients              - List (search, filters, pagination)
POST   /api/patients              - Create patient
GET    /api/patients/stats        - Dashboard statistics
GET    /api/patients/:id          - Patient details
PATCH  /api/patients/:id          - Update patient
```

### Documents
```
POST   /api/documents                              - Upload document
GET    /api/patients/:id/documents                 - List documents
PATCH  /api/documents/:id                          - Update metadata
DELETE /api/documents/:id                          - Soft delete
GET    /api/patients/:id/documents/export          - ZIP export
```

### Users (Admin only)
```
GET    /api/users              - List users
POST   /api/users              - Create user
PATCH  /api/users/:id/status   - Activate/deactivate
GET    /api/staff-master        - Approved staff list
POST   /api/staff-master        - Add to approved list
```

### Audit
```
GET    /api/audit-logs    - Immutable audit trail (Admin/HOD)
```

---

## 🔧 Environment Variables

### Backend (.env)
```env
PORT=5000
NODE_ENV=production
DB_HOST=localhost
DB_PORT=5432
DB_NAME=hospital_dms
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_POOL_MIN=2
DB_POOL_MAX=20
JWT_SECRET=64-char-minimum-secret-key
JWT_EXPIRES_IN=8h
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
S3_BUCKET_NAME=your-bucket-name
CORS_ORIGIN=https://yourdomain.com
```

### Frontend (.env)
```env
REACT_APP_API_URL=https://yourdomain.com/api
```
