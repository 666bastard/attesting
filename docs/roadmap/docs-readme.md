# 5A · README + Quickstart + Architecture Diagram

**Status:** 📋 Planned

## Scope

Overhaul README.md for public consumption. Add quickstart guide, architecture diagram, and screenshots.

## README Sections

1. **Hero** — one-line description, badges (license, build, npm)
2. **What is Attesting** — 3-sentence explanation of the entity graph approach
3. **Quickstart** — clone, install, init, import catalog, run first assessment (under 5 minutes)
4. **Screenshots** — dashboard, risk matrix, drift alerts, mapping view
5. **Architecture** — Mermaid diagram showing: CLI → Services → SQLite, Web UI → API → Services → SQLite, Propagation engine connecting all modules
6. **Bundled Catalogs** — table of 14 frameworks with control counts
7. **CLI Reference** — command tree with one-line descriptions
8. **API Overview** — endpoint groups with links to OpenAPI spec
9. **Contributing** — link to CONTRIBUTING.md
10. **License** — MIT

## Files to Create/Modify

- `README.md` — full rewrite
- `docs/architecture.md` — detailed architecture explanation
- `docs/quickstart.md` — step-by-step getting started
- Screenshots in `docs/images/`

## Exit Criteria

- [ ] New user can follow quickstart and have Attesting running in under 5 minutes
- [ ] Architecture diagram renders in GitHub markdown
- [ ] No dead links
