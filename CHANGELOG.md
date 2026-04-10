# Changelog

All notable changes to Attesting are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-04-09

### Added
- Phase 1: CLI parity — risk, intel, drift, and connector command groups (22 commands)
- Phase 2: Web UI pages — assets, intel, drift, connectors with glassmorphism design
- Phase 3: Test coverage — 288 tests across 44 files (propagation, disposition, intel, drift, connectors, API routes)
- Phase 4 (partial): NVD adapter with CVSS mapping and auto-corroboration; SBOM ingestion (CycloneDX + SPDX)
- Proprietary catalog import with file security scanning (SIG, ISO 27001, OSCAL, CSV)
- GitHub Actions CI pipeline (build, test, security, accessibility, OSCAL validation, catalog integrity)
- CodeQL code scanning, Dependabot, CODEOWNERS, SECURITY.md

## [0.2.0] - 2026-04-08

### Added
- GRC platform: governance module (policies, committees, roles), risk management, glassmorphism UI
- v2 integration: threat intelligence, asset inventory, drift detection, connectors, audit trail
- Propagation engine with entity graph traversal
- CISA KEV connector (operational)
- Disposition pipeline with NLP classification

## [0.1.0] - 2026-04-08

### Added
- Initial compliance engine: catalogs, controls, mappings, implementations
- OSCAL catalog importer (NIST 800-171, 800-53)
- SIG Content Library importer
- Generic CSV catalog importer
- Cross-framework control mapping with transitive resolution
- SIG questionnaire export, OSCAL export, CSV/PDF/SOA exports
- Assessment creation, evaluation, POA&M generation
- Web UI dashboard with React + Vite + Tailwind
