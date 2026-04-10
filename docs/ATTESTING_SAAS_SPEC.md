# Attesting SaaS — Multi-Tenant Architecture Spec

## Overview

Transform Attesting from a local-first single-user CLI tool into a multi-tenant SaaS platform with per-seat pricing, role-based access control, and PostgreSQL backend. The open-source CLI remains free. The hosted web platform is the paid product.

---

## Architecture Decision: Shared Database with Tenant Scoping

Use a single PostgreSQL database with `tenant_id` on every table. This is the right choice because:
- Simpler operations (one database to manage, backup, migrate)
- Shared catalogs and mappings across tenants without duplication
- Easier cross-tenant analytics for the platform (usage metrics, framework popularity)
- Row-level security in Postgres enforces isolation at the DB level

The tradeoff (tenant isolation risk) is mitigated by Postgres Row-Level Security (RLS) policies that make it physically impossible for a query in tenant A's context to return tenant B's data.

---

## Database: Postgres Migration from SQLite

### Connection
- Use `pg` (node-postgres) with connection pooling via `@neondatabase/serverless` or standard `pg.Pool`
- Connection string from environment variable `DATABASE_URL`
- Connection pool: min 2, max 20 per server instance

### Schema Changes

Every existing table gets a `tenant_id` column. Catalogs and controls have a dual model: system-level (shared, `tenant_id IS NULL`) and tenant-level (private, `tenant_id = X`).

```sql
-- ============================================================
-- TENANTS & BILLING
-- ============================================================

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,                     -- "Nutanix, Inc."
    slug TEXT NOT NULL UNIQUE,              -- "nutanix" (URL-safe)
    plan TEXT NOT NULL DEFAULT 'free',      -- 'free', 'starter', 'professional', 'enterprise'
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    seat_limit INTEGER NOT NULL DEFAULT 3,  -- based on plan
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tenant_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer',
    -- 'owner'       = full admin, billing, can delete tenant
    -- 'admin'       = manage members, manage all data, export
    -- 'editor'      = add/edit implementations, assessments, mappings
    -- 'analyst'     = read all data, run reports, export
    -- 'viewer'      = read-only access to dashboards and frameworks
    invited_by UUID REFERENCES users(id),
    invited_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, user_id)
);

CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    invited_by UUID NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,             -- secure random token for invite link
    expires_at TIMESTAMPTZ NOT NULL,        -- 7 days from creation
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USERS (Better Auth manages core user records)
-- ============================================================

-- Better Auth creates its own user/session/account tables.
-- This table extends the user with Attesting-specific fields.
CREATE TABLE user_profiles (
    user_id UUID PRIMARY KEY,               -- matches Better Auth user.id
    display_name TEXT,
    avatar_url TEXT,
    last_active_tenant_id UUID REFERENCES tenants(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- EXISTING TABLES — ADD tenant_id
-- ============================================================

-- Organizations become scoped to tenants
ALTER TABLE organizations ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE scopes ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Catalogs: NULL tenant_id = system catalog (shared), non-NULL = tenant-private
ALTER TABLE catalogs ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Controls inherit tenant scope from their catalog
-- (no separate tenant_id needed — join through catalog)

-- Mappings: system mappings (from auto-link on system catalogs) are shared
-- tenant-specific mappings are private
ALTER TABLE control_mappings ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Implementations are always tenant-private
ALTER TABLE implementations ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);

-- Assessments are always tenant-private  
ALTER TABLE assessments ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);
ALTER TABLE assessment_results ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);

-- Evidence is always tenant-private
ALTER TABLE evidence ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);

-- POA&M items are always tenant-private
ALTER TABLE poam_items ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);

-- Catalog watches can be system-level or tenant-level
ALTER TABLE catalog_watches ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

-- Set the current tenant for RLS context
-- Called at the start of every request via middleware
-- SET LOCAL app.current_tenant_id = 'uuid-here';

ALTER TABLE implementations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_implementations ON implementations
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_assessments ON assessments
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_assessment_results ON assessment_results
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_evidence ON evidence
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

ALTER TABLE poam_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_poam ON poam_items
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Catalogs: visible if system-level OR belongs to current tenant
ALTER TABLE catalogs ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_visibility ON catalogs
    USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Mappings: same pattern
ALTER TABLE control_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY mapping_visibility ON control_mappings
    USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id')::UUID);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL,
    action TEXT NOT NULL,
    -- 'implementation.create', 'implementation.update', 'implementation.delete'
    -- 'assessment.create', 'assessment.evaluate'
    -- 'export.sig', 'export.oscal', 'export.csv'
    -- 'catalog.import', 'mapping.auto-link'
    -- 'member.invite', 'member.remove', 'member.role-change'
    resource_type TEXT,                     -- 'implementation', 'assessment', etc.
    resource_id UUID,
    details JSONB,                          -- action-specific metadata
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, created_at DESC);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_members_tenant ON tenant_members(tenant_id);
CREATE INDEX idx_members_user ON tenant_members(user_id);
CREATE INDEX idx_implementations_tenant ON implementations(tenant_id);
CREATE INDEX idx_assessments_tenant ON assessments(tenant_id);
CREATE INDEX idx_catalogs_tenant ON catalogs(tenant_id);
CREATE INDEX idx_mappings_tenant ON control_mappings(tenant_id);
```

---

## Authentication: Better Auth

### Setup
- Use `better-auth` package with email/password + OAuth (Google, Microsoft)
- Session management via secure httpOnly cookies
- CSRF protection enabled

### Configuration
```typescript
import { betterAuth } from 'better-auth';
import { pg } from 'better-auth/adapters/pg';

export const auth = betterAuth({
  database: pg(pool),             // shared Postgres pool
  emailAndPassword: { enabled: true },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,   // 7 days
    updateAge: 60 * 60 * 24,        // refresh daily
  },
});
```

### Auth Flow
1. User signs up → Better Auth creates user record
2. User creates a tenant (org) → becomes owner
3. User invites team members via email → invitation token generated
4. Invited user signs up or logs in → accepts invitation → becomes member
5. On login, user sees list of tenants they belong to → selects one → tenant context set

### Middleware
Every API request goes through:
1. `authMiddleware` — validates session, extracts user_id
2. `tenantMiddleware` — extracts tenant_id from header (`X-Tenant-ID`) or cookie, verifies user is a member, sets RLS context
3. `roleMiddleware(requiredRole)` — checks the user's role in the current tenant has sufficient permissions

```typescript
// Middleware chain on every protected route
app.use('/api/*', authMiddleware, tenantMiddleware);

// Role-gated routes
app.post('/api/implementations', roleMiddleware('editor'), createImplementation);
app.delete('/api/implementations/:id', roleMiddleware('admin'), deleteImplementation);
app.post('/api/members/invite', roleMiddleware('admin'), inviteMember);
app.post('/api/billing/*', roleMiddleware('owner'), billingRoutes);
```

---

## Role-Based Access Control (RBAC)

### Roles and Permissions

| Permission | Owner | Admin | Editor | Analyst | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| View dashboards | ✓ | ✓ | ✓ | ✓ | ✓ |
| Browse frameworks & controls | ✓ | ✓ | ✓ | ✓ | ✓ |
| View implementations | ✓ | ✓ | ✓ | ✓ | ✓ |
| View mappings & resolve | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export (SIG, OSCAL, CSV, PDF) | ✓ | ✓ | ✓ | ✓ | ✗ |
| Add/edit implementations | ✓ | ✓ | ✓ | ✗ | ✗ |
| Create/run assessments | ✓ | ✓ | ✓ | ✗ | ✗ |
| Manage POA&M items | ✓ | ✓ | ✓ | ✗ | ✗ |
| Import catalogs | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage custom mappings | ✓ | ✓ | ✗ | ✗ | ✗ |
| Import SIG .xlsm | ✓ | ✓ | ✗ | ✗ | ✗ |
| Invite/remove members | ✓ | ✓ | ✗ | ✗ | ✗ |
| Change member roles | ✓ | ✓ | ✗ | ✗ | ✗ |
| View audit log | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage billing | ✓ | ✗ | ✗ | ✗ | ✗ |
| Delete tenant | ✓ | ✗ | ✗ | ✗ | ✗ |
| Transfer ownership | ✓ | ✗ | ✗ | ✗ | ✗ |

### Role Hierarchy
Owner > Admin > Editor > Analyst > Viewer

An admin can do everything an editor can do, plus member management and catalog imports. An editor can do everything an analyst can do, plus create/modify data. And so on.

---

## Pricing Plans

### Free
- 1 user (owner only)
- 3 frameworks imported
- 50 implementations
- CSV export only
- Community support
- **$0/month**

### Starter
- Up to 5 seats
- 10 frameworks
- Unlimited implementations
- All export formats (SIG, OSCAL, SOA, CSV, PDF)
- Mapping resolver
- Email support
- **$29/seat/month** (billed annually: $25/seat/month)

### Professional
- Up to 25 seats
- Unlimited frameworks
- Unlimited implementations
- All export formats
- Regulatory change monitoring (catalog watch + diff)
- Assessment & POA&M management
- Audit log
- Priority support
- **$59/seat/month** (billed annually: $49/seat/month)

### Enterprise
- Unlimited seats
- Everything in Professional
- SSO (SAML 2.0 / OIDC)
- Custom framework imports
- API access for CI/CD integration
- Dedicated support
- Custom contract
- **Contact sales**

### Plan Enforcement
```typescript
const PLAN_LIMITS = {
  free:         { seats: 1,  frameworks: 3,  implementations: 50,  exports: ['csv'],          features: ['dashboard', 'frameworks', 'mappings'] },
  starter:      { seats: 5,  frameworks: 10, implementations: -1,  exports: ['csv', 'sig', 'oscal', 'soa', 'pdf'], features: ['dashboard', 'frameworks', 'mappings', 'implementations', 'export'] },
  professional: { seats: 25, frameworks: -1, implementations: -1,  exports: ['csv', 'sig', 'oscal', 'soa', 'cmmc', 'pdf'], features: ['all'] },
  enterprise:   { seats: -1, frameworks: -1, implementations: -1,  exports: ['all'],          features: ['all', 'sso', 'api'] },
};
// -1 = unlimited
```

---

## Stripe Integration

### Setup
- Use `stripe` npm package
- Webhook endpoint at `/api/billing/webhook`
- Products and prices configured in Stripe Dashboard

### Billing Flow
1. Owner creates tenant → starts on Free plan
2. Owner clicks "Upgrade" → redirected to Stripe Checkout
3. Stripe creates subscription → webhook fires `customer.subscription.created`
4. Webhook handler updates tenant plan and seat_limit
5. Adding seats: owner clicks "Add seat" → Stripe subscription item quantity updated
6. Removing seats: at next billing cycle (proration handled by Stripe)
7. Cancellation: downgrade to Free at end of billing period

### Webhook Events to Handle
```typescript
switch (event.type) {
  case 'customer.subscription.created':
  case 'customer.subscription.updated':
    // Update tenant plan + seat_limit from subscription metadata
    break;
  case 'customer.subscription.deleted':
    // Downgrade tenant to free plan
    break;
  case 'invoice.payment_failed':
    // Flag tenant as payment_failed, send warning email
    // Grace period: 7 days before restricting access
    break;
  case 'invoice.paid':
    // Clear payment_failed flag
    break;
}
```

### Seat Management
- Seats are Stripe subscription item quantities
- Adding a seat: increment quantity → prorated charge
- Removing a seat: decrement quantity → credit on next invoice
- Can't remove seats below current member count (must remove members first)
- Free plan: seat management disabled, always 1

---

## Tenant Context Flow

### API Request Lifecycle
```
Request arrives
    │
    ▼
authMiddleware
    ├── Extract session cookie
    ├── Validate with Better Auth
    ├── Attach user to request context
    └── 401 if invalid
    │
    ▼
tenantMiddleware
    ├── Extract tenant_id from X-Tenant-ID header
    ├── Verify user is a member of this tenant
    ├── Fetch user's role in this tenant
    ├── SET LOCAL app.current_tenant_id = tenant_id (for RLS)
    ├── Attach tenant + role to request context
    └── 403 if not a member
    │
    ▼
roleMiddleware(requiredRole)  [on protected routes]
    ├── Check req.role >= requiredRole
    └── 403 if insufficient
    │
    ▼
Route handler executes
    ├── All queries automatically scoped by RLS
    ├── Audit log entry written
    └── Response returned
```

### Frontend Tenant Switching
- After login, user sees a tenant selector if they belong to multiple orgs
- Selected tenant stored in cookie/localStorage
- All API requests include `X-Tenant-ID` header
- Switching tenants refreshes all data

---

## New API Routes

### Auth Routes (Better Auth handles these)
```
POST /api/auth/signup          → create user
POST /api/auth/login           → create session
POST /api/auth/logout          → destroy session
GET  /api/auth/session         → current user + session
POST /api/auth/google          → OAuth with Google
POST /api/auth/microsoft       → OAuth with Microsoft
```

### Tenant Routes
```
GET    /api/tenants                → list user's tenants
POST   /api/tenants               → create tenant (user becomes owner)
GET    /api/tenants/:id            → tenant details
PUT    /api/tenants/:id            → update tenant (admin+)
DELETE /api/tenants/:id            → delete tenant (owner only)
```

### Member Routes
```
GET    /api/members                → list members in current tenant
POST   /api/members/invite         → send invitation (admin+)
PUT    /api/members/:id/role       → change role (admin+)
DELETE /api/members/:id            → remove member (admin+)
POST   /api/invitations/:token/accept → accept invitation
```

### Billing Routes
```
POST   /api/billing/checkout       → create Stripe Checkout session
POST   /api/billing/portal         → create Stripe Customer Portal session
GET    /api/billing/subscription   → current plan details
POST   /api/billing/webhook        → Stripe webhook handler
```

### Audit Routes
```
GET    /api/audit                  → audit log (admin+, paginated)
```

### Existing Routes — Modified
All existing routes (/api/catalogs, /api/implementations, etc.) remain the same but are now:
- Protected by authMiddleware + tenantMiddleware
- Automatically scoped by RLS
- Audit-logged for write operations

---

## Frontend Changes

### New Pages
- `/login` — email/password + Google + Microsoft sign-in
- `/signup` — registration
- `/tenants` — tenant selector (shown after login if user has multiple tenants)
- `/settings` — tenant settings (name, slug)
- `/settings/members` — member management (invite, roles, remove)
- `/settings/billing` — plan details, upgrade/downgrade, seat management
- `/settings/audit` — audit log viewer

### Header Changes
- Replace "Acme Corp" with actual tenant name
- Add user avatar + dropdown menu (profile, settings, switch tenant, logout)
- Show current plan badge (Free, Starter, Professional, Enterprise)

### Role-Based UI
- Hide UI elements the user's role can't access:
  - Viewers: no "Add Implementation" buttons, no edit actions, no export buttons
  - Analysts: export buttons visible, but no edit actions
  - Editors: full CRUD on implementations/assessments, no admin settings
  - Admins: everything except billing
  - Owners: everything
- Use a `usePermission(action)` hook that checks current role against the permission matrix
- Gray out / hide features that exceed the plan limit with an "Upgrade" tooltip

### Invite Flow UI
- Admin clicks "Invite Member" → modal with email + role selector
- Email sent with magic link
- Recipient clicks link → signs up or logs in → auto-joins tenant with assigned role

---

## Migration Strategy: SQLite → Postgres

### Phase 1: Dual Support
- Keep SQLite support for the open-source CLI (local-first)
- Add Postgres support for the SaaS version
- Abstract the database layer behind an interface:

```typescript
interface DatabaseAdapter {
  query<T>(sql: string, params?: any[]): T[];
  run(sql: string, params?: any[]): { changes: number };
  get<T>(sql: string, params?: any[]): T | undefined;
  transaction<T>(fn: () => T): T;
}

class SqliteAdapter implements DatabaseAdapter { ... }
class PostgresAdapter implements DatabaseAdapter { ... }
```

- CLI uses SqliteAdapter (default, no config needed)
- SaaS uses PostgresAdapter (configured via DATABASE_URL)
- All existing code calls the adapter interface, not the DB directly

### Phase 2: Schema Migration
- Write a migration script that converts the SQLite schema to Postgres
- Handle SQLite-specific syntax (datetime('now') → NOW(), TEXT → TEXT, etc.)
- Add tenant_id columns, RLS policies, and new tables
- Use a migration runner (e.g., `node-pg-migrate` or raw SQL files in `migrations/`)

### Phase 3: Data Seeding
- System catalogs (NIST, CMMC, GDPR, etc.) seeded on first deployment
- Auto-link mappings run on seed
- Each new tenant starts with all system catalogs visible

---

## Deployment

### Infrastructure
- **Web app:** Vercel, Railway, or Fly.io (Node.js + Express)
- **Database:** Neon (serverless Postgres, branch per environment)
- **Auth:** Better Auth (self-hosted within the app)
- **Billing:** Stripe
- **Email:** Postmark or Resend (for invitations, notifications)
- **CDN:** Cloudflare (for static frontend assets)

### Environment Variables
```
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
EMAIL_API_KEY=...
APP_URL=https://app.attesting.dev
```

### Domain Structure
- `attesting.dev` — marketing site
- `app.attesting.dev` — SaaS application
- `docs.attesting.dev` — documentation
- `api.attesting.dev` — API (if separated from app)

---

## Build Order

### Phase 1: Database Abstraction (Week 1)
- Create DatabaseAdapter interface
- Implement SqliteAdapter (wrap existing better-sqlite3 code)
- Implement PostgresAdapter
- Refactor all existing code to use the adapter
- All 130+ existing tests still pass on SQLite
- Add Postgres test suite running against a test database

### Phase 2: Auth + Tenants (Week 2)
- Integrate Better Auth
- Create tenants, tenant_members, invitations, user_profiles tables
- Build auth middleware, tenant middleware, role middleware
- Build login/signup/tenant-selector pages
- Build invite flow (send email, accept link)

### Phase 3: Multi-Tenant Data Layer (Week 3)
- Add tenant_id to all existing tables
- Implement RLS policies
- Modify all API routes to use tenant context
- Modify all CLI commands to optionally accept --tenant flag
- Seed system catalogs on deployment
- Verify tenant isolation (critical: write tests that prove tenant A cannot see tenant B's data)

### Phase 4: RBAC (Week 4)
- Implement role checking in middleware
- Build member management pages (invite, roles, remove)
- Add usePermission hook to frontend
- Hide/show UI elements based on role
- Build audit log table and viewer

### Phase 5: Billing (Week 5)
- Integrate Stripe (products, prices, checkout, portal, webhooks)
- Build billing settings page
- Implement plan enforcement (seat limits, framework limits, export limits)
- Build upgrade prompts in UI when limits are hit

### Phase 6: Polish + Launch (Week 6)
- Marketing site at attesting.dev
- Documentation at docs.attesting.dev
- Onboarding flow for new tenants (guided setup: create org → import first framework → add first implementation)
- Email notifications (invitation, plan changes, regulatory updates from catalog watch)
- Production deployment with monitoring

---

## What Stays Open Source

The open-source CLI (`attesting` npm package) remains free and fully functional:
- All importers and exporters
- Mapping resolver and auto-link
- Coverage calculator
- Diff and change management
- Assessment and POA&M
- Local SQLite database
- All 20+ framework catalogs

The SaaS adds:
- Multi-tenant web UI
- Authentication and team management
- Role-based access control
- Billing and seat management
- Audit logging
- Shared system catalogs (auto-updated)
- Hosted infrastructure (no setup needed)

This is the GitLab/Supabase model: open-source core that's genuinely useful on its own, hosted platform for teams that want convenience and collaboration.
