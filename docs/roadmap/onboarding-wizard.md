# Attesting Onboarding — Specification

**Goal:** A new user goes from `npm install` to a working GRC posture in one guided session. The wizard adapts to org size — a solo practitioner skips what they don't need, an enterprise team gets the full setup.

---

## Onboarding Stages

### Stage 1 · Organization Setup
**What:** Create the org profile — name, industry, size, primary contact.
**Why:** Every entity in Attesting is scoped to an org. Nothing works without this.
**Scaling:** Same for everyone. Takes 30 seconds.

**CLI:** `attesting setup` launches the wizard. First prompt:
```
Welcome to Attesting.

Let's set up your organization.

  Organization name: ___
  Industry [defense / finance / healthcare / technology / government / other]: ___
  Size [small / medium / large / enterprise]: ___
  Primary contact name: ___
  Primary contact email: ___
```

**Web UI:** First-launch splash screen. Same fields as a form. Cannot navigate to any other page until org is created.

**What happens:** Creates `organizations` row. Org size determines wizard defaults in later stages (which catalogs to suggest, how many scopes to prompt for, etc.).

---

### Stage 2 · Select Compliance Frameworks
**What:** Choose which catalogs to activate. Attesting bundles 14 — the wizard recommends based on industry and size.
**Why:** Frameworks define the controls the org will be assessed against. Everything downstream (implementations, assessments, risk mapping) depends on this choice.
**Scaling:** Solo practitioner picks 1-2. Enterprise might activate 6+.

**Recommendations engine:**

| Industry | Size | Suggested Catalogs |
|----------|------|--------------------|
| Defense | Any | NIST 800-171, CMMC 2.0, NISPOM |
| Finance | Any | SOC 2, PCI DSS, NIST CSF |
| Healthcare | Any | HIPAA, SOC 2, NIST CSF |
| Technology | Small | SOC 2, NIST CSF |
| Technology | Medium+ | SOC 2, NIST CSF, ISO 27001 |
| Government | Any | NIST 800-53, FedRAMP baseline, NIST CSF |
| Any (EU) | Any | Add GDPR, EU AI Act |
| Any (CA) | Any | Add CCPA/CPRA |

**CLI:**
```
Based on your industry (defense) and size (medium), we recommend:

  [✓] NIST 800-171 Rev 3          (110 controls)
  [✓] CMMC 2.0 Level 2            (110 controls)
  [✓] NISPOM 32 CFR 117           (72 controls)
  [ ] NIST 800-53 Rev 5            (1,189 controls)
  [ ] NIST CSF 2.0                 (106 controls)

  Toggle with arrow keys + space. Press Enter to confirm.
  
  Want to import a proprietary catalog (SIG Full, ISO 27001)? [y/N]
```

**Web UI:** Checklist cards with control counts, descriptions, and "recommended" badges. Proprietary import button at bottom.

**What happens:** Activates selected catalogs in the org scope. Cross-framework mappings between selected catalogs are auto-resolved. If user imports a proprietary catalog, the import-proprietary flow launches inline.

---

### Stage 3 · Define Scopes
**What:** Create organizational scopes (boundaries/environments the controls apply to).
**Why:** Most orgs have different environments with different compliance requirements. A "production AWS" scope has different controls than "corporate network."
**Scaling:** Solo practitioner might use a single "All Systems" scope. Enterprise creates per-environment or per-business-unit scopes.

**CLI:**
```
Scopes define the boundaries where your controls apply.
Small orgs often use a single scope. Larger orgs create per-environment scopes.

  How many scopes do you need?
    (1) Single scope — "All Systems"
    (2) By environment — Production, Development, Corporate
    (3) Custom — I'll define my own
    
  > 2

  Creating scopes:
    ✓ Production
    ✓ Development  
    ✓ Corporate

  Which catalogs apply to each scope? (default: all selected catalogs apply to all scopes)
    Customize? [y/N]
```

**Web UI:** Scope builder with drag-and-drop catalog assignment. Pre-filled templates for common patterns.

**What happens:** Creates `scopes` rows. Associates catalogs with scopes. Controls are now queryable per-scope.

---

### Stage 4 · Register Key Assets
**What:** Add the systems, applications, and infrastructure that are in scope.
**Why:** Assets are what threats target and controls protect. The propagation engine correlates threats to assets by platform.
**Scaling:** Solo practitioner adds 3-5 critical systems. Enterprise imports from CMDB or cloud provider.

**CLI:**
```
Let's register your key assets — the systems your controls protect.
You can add more later. Start with the most critical ones.

  Add an asset:
    Name: ___
    Platform [aws / azure / gcp / on-prem / saas / identity / other]: ___
    Type [application / infrastructure / data-store / network / endpoint]: ___
    Scope [Production / Development / Corporate]: ___
    Owner (optional): ___

  Add another? [y/N]

  Or import from:
    (1) CSV file
    (2) AWS Security Hub (if connector configured)
    (3) Azure / GCP (if connector configured)
    (4) Skip for now
```

**Web UI:** Asset form with bulk CSV upload option. Cloud import buttons (grayed out until connectors configured).

**What happens:** Creates `assets` rows with platform metadata. These will be used for threat correlation once intel starts flowing.

---

### Stage 5 · Assign Owners
**What:** Register the people responsible for controls, risks, and policies.
**Why:** Ownership drives accountability. Drift alerts and tasks route to owners.
**Scaling:** Solo practitioner is the owner of everything (wizard auto-assigns). Enterprise assigns by role/department.

**CLI:**
```
Who manages your compliance program?

  For small teams, you can be the owner of everything.
  For larger teams, assign owners by area.

    (1) I'm the sole owner — assign everything to me
    (2) I'll add team members now
    (3) Skip — I'll assign owners later

  > 2

  Add a team member:
    Name: ___
    Email: ___
    Role [ciso / security-lead / analyst / engineer / auditor]: ___
```

**Web UI:** Team member cards with role badges. "Just me" button for solo practitioners.

**What happens:** Creates `owners` rows. If solo, auto-links owner to all scopes.

---

### Stage 6 · Initial Risk Posture
**What:** Seed the risk register with an initial set of risks, or run a baseline assessment.
**Why:** Gives the org a starting posture to improve from. Without risks, the risk matrix and dashboards are empty.
**Scaling:** Solo practitioner starts with 3-5 top-of-mind risks. Enterprise imports an existing risk register.

**CLI:**
```
Let's establish your initial risk posture.

    (1) Quick start — add 3-5 top risks manually
    (2) Import existing risk register (CSV)
    (3) Auto-generate from framework gaps — run a gap analysis against your selected catalogs
    (4) Skip — I'll add risks later

  > 1

  Add a risk:
    Title: ___
    Category [operational / technical / compliance / strategic / third-party]: ___
    Likelihood (1-5): ___
    Impact (1-5): ___
    Owner: ___ (from registered owners)
    Treatment [mitigate / accept / transfer / avoid]: ___
```

**Web UI:** Three-tab interface: Manual entry, CSV import, Gap analysis.

**What happens:** Creates `risks` rows with scores. Risk matrix populates. If gap analysis chosen, runs against selected catalogs and auto-generates risks for uncovered control families.

---

### Stage 7 · Connect Threat Feeds (Optional)
**What:** Set up connectors for continuous threat intelligence.
**Why:** Automated threat feeds correlate against assets and flag control gaps without manual effort.
**Scaling:** Solo practitioner enables CISA KEV (free, no config). Enterprise adds CrowdStrike, NVD, cloud posture connectors.

**CLI:**
```
Attesting can pull threat intelligence from external feeds automatically.

  Available connectors:
    [✓] CISA KEV (free, no API key needed) — recommended for everyone
    [ ] NIST NVD (free, API key optional)
    [ ] CrowdStrike Falcon (requires API credentials)
    [ ] AWS Security Hub (requires AWS credentials)
    [ ] Skip — I'll configure connectors later

  Enabling CISA KEV...
    ✓ Connector registered
    ✓ Initial sync: 1,247 known exploited vulnerabilities loaded
    ✓ 3 correlations found against your registered assets
```

**Web UI:** Connector marketplace cards. One-click enable for CISA KEV. Config forms for credentialed connectors.

**What happens:** Creates `connectors` rows, runs initial sync, triggers propagation (threat→asset correlation→risk creation).

---

### Stage 8 · Review & Launch
**What:** Summary of everything configured. Verify and finalize.
**Why:** Gives the user confidence that setup is complete and shows them what to do next.

**CLI:**
```
  ┌──────────────────────────────────────────────┐
  │  Attesting Setup Complete                    │
  ├──────────────────────────────────────────────┤
  │  Organization:  Acme Corp                    │
  │  Catalogs:      3 active (293 controls)      │
  │  Scopes:        3 (Production, Dev, Corp)    │
  │  Assets:        12 registered                │
  │  Owners:        4 team members               │
  │  Risks:         8 in register                │
  │  Connectors:    1 active (CISA KEV)          │
  │  Risk Score:    Moderate (avg 12.4)           │
  └──────────────────────────────────────────────┘

  What's next:
    • Run `attesting web serve` to open the dashboard
    • Run `attesting assessment create` to start your first assessment
    • Run `attesting implementation add` to document control implementations
    • Run `attesting drift check` to run your first posture check

  Full documentation: https://attesting.dev/docs
```

**Web UI:** Summary dashboard with the same stats. "Start Assessment" and "Add Implementation" CTAs. Guided tour overlay highlighting key navigation items.

---

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `src/commands/setup/wizard.ts` | CLI wizard orchestrator — runs stages 1-8 |
| `src/commands/setup/prompts.ts` | Interactive prompt helpers (select, confirm, input, multi-select) |
| `src/commands/setup/recommendations.ts` | Framework recommendation engine by industry/size |
| `src/services/onboarding/state.ts` | Tracks wizard progress (which stages completed, resume support) |
| `src/services/onboarding/gap-seed.ts` | Auto-generates initial risks from framework gap analysis |
| `src/web/client/components/onboarding/SetupWizard.tsx` | React wizard container with step navigation |
| `src/web/client/components/onboarding/OrgStep.tsx` | Stage 1 |
| `src/web/client/components/onboarding/CatalogsStep.tsx` | Stage 2 |
| `src/web/client/components/onboarding/ScopesStep.tsx` | Stage 3 |
| `src/web/client/components/onboarding/AssetsStep.tsx` | Stage 4 |
| `src/web/client/components/onboarding/OwnersStep.tsx` | Stage 5 |
| `src/web/client/components/onboarding/RiskStep.tsx` | Stage 6 |
| `src/web/client/components/onboarding/ConnectorsStep.tsx` | Stage 7 |
| `src/web/client/components/onboarding/SummaryStep.tsx` | Stage 8 |
| `src/web/routes/onboarding.ts` | API routes for wizard state + framework recommendations |

### Files to Modify

- `src/index.ts` — register `attesting setup` command
- `src/web/client/App.tsx` — redirect to wizard when no org exists
- `src/web/server.ts` — mount `/api/onboarding` routes

### Dependencies

- `inquirer` or `prompts` for CLI interactive prompts (evaluate which is lighter)

### Key Design Decisions

- **Resumable:** Wizard state persists in DB. If user exits mid-setup, `attesting setup` resumes from last completed stage.
- **Skippable:** Every stage after Stage 1 (org) can be skipped. The wizard tracks what was skipped and can remind later.
- **Re-runnable:** `attesting setup` can be run again to add more catalogs, scopes, assets. It detects existing config and offers to extend rather than overwrite.
- **Web-first detection:** When the web server starts and no org exists, redirect all routes to the setup wizard. After setup, redirect to dashboard.
- **No lock-in:** Everything the wizard does can also be done via individual CLI commands or API calls. The wizard is sugar, not a gate.

---

## Exit Criteria

- [ ] `attesting setup` walks through all 8 stages interactively
- [ ] Web UI redirects to wizard on first launch
- [ ] Solo practitioner completes setup in under 5 minutes
- [ ] Enterprise user can import CSV assets and risk register during setup
- [ ] Wizard is resumable after exit
- [ ] `attesting setup --status` shows which stages are completed
- [ ] CISA KEV connector auto-syncs during setup and shows correlations