# Modernization Exec Plan – Clinical Extractor

This document describes the key work required to bring the Clinical Extractor repository to a production‑ready, backend‑first architecture with an improved user experience while preserving all existing features. Codex Web agents or similar AI coding tools should follow this plan step‑by‑step. Please update this file as tasks are completed.

## 🎯 Overall Goal

Transform the current hybrid frontend/back‑end AI implementation into a secure, maintainable, backend‑centric architecture and polish the user interface for clinical users. After finishing this plan:

- No API keys are exposed in the compiled frontend; all AI traffic flows through the FastAPI backend.
- All existing features still work (document upload, PDF viewing, PICO and summary generation, table extraction, deep analysis, multi‑agent flows, semantic search, exports, annotations, etc.).
- Improved UX with clear side panels and feedback during long‑running AI operations.
- Tests remain green (`npm test`, `npm run test:e2e`, `pytest`, `npm run lint`), and new tests cover the new backend routes and AIService integration.

## ✅ Current Status (Nov 20 2025)

- Frontend contains an `AIService.ts` which still loads Gemini/Claude API keys from `import.meta.env` and calls the AI models directly.
- Backend provides preliminary routes in `backend/app/routers/ai.py` and `backend/app/services/llm.py` but not all seven AI functions are implemented.
- The repository contains many design and migration documents, including `BACKEND_MIGRATION_PLAN.md`, `PRODUCTION_READINESS_ASSESSMENT.md`, and `PHASE4_UNIFIED_CACHE_COMPLETE.md`.
- The codebase has strong test coverage (unit, integration, Playwright E2E) and CI workflows. Most tests currently pass when the API key is supplied.

## 🗺️ Tasks Overview

The work is divided into four main categories. Each item should be checked off (`[x]`) when completed and a brief comment added summarising how it was addressed.

### 1. Backend Integration & Security

- [ ] **Implement all AI endpoints in `backend/app/routers/ai.py`** using the existing LLM service:
  - Endpoints: `/api/ai/generate-pico`, `/generate-summary`, `/validate-field`, `/find-metadata`, `/extract-tables`, `/analyze-image`, `/deep-analysis`.
  - Apply authentication and rate limiting (see `BACKEND_MIGRATION_PLAN.md`).
  - Use environment variables (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`) loaded in backend only.

- [ ] **Secure the LLM client** by finishing `backend/app/services/llm.py`:
  - Handle primary/fallback models using `GEMINI_API_KEY` and `ANTHROPIC_API_KEY`.
  - Validate inputs, sanitise prompts and handle errors gracefully.
  - Log request/response metadata for monitoring.

- [ ] **Remove API keys from the frontend:**
  - Delete the lines in `src/services/AIService.ts` that load `VITE_GEMINI_API_KEY` or similar; ensure no sensitive strings remain in production builds.
  - Update `.env.example` to remove `VITE_GEMINI_API_KEY` and add `VITE_BACKEND_URL` pointing at the FastAPI server.

- [ ] **Expose a dev‑only fallback:**
  - Allow the direct‑to‑LLM path to be enabled only via an explicit flag (e.g. `USE_FRONTEND_AI_DEV_ONLY`) for local prototyping. In production (`npm run build`), it must default to backend‑only.

- [ ] **Write backend tests:**
  - Add or update tests in the backend folder to cover at least one full AI call per route.
  - Ensure authentication and rate limiting are exercised.

### 2. Frontend Refactor & UX

- [ ] **Refactor `AIService.ts`:**
  - Change each of the seven AI functions to use `BackendClient` (or `BackendProxyService`) instead of making direct Gemini/Claude calls.
  - Preserve the existing public API (function names, parameters, return types) so that other parts of the app continue to work without change.
  - Remove any functions or variables used solely for direct model calls, such as `initializeAI()`, `ai` or `API_KEY` constants.

- [ ] **Improve global window API:**
  - Ensure all methods exposed via `window.ClinicalExtractor.*` (e.g. `generatePICO`, `handleDeepAnalysis`, `runFullAIPipeline`) now call the backend routes. Provide consistent error handling and loading indicators.

- [ ] **Enhance UX layout:**
  - Create a clear panel layout: main document view on the left and a right‑hand panel for AI actions, extracted fields, and results.
  - Introduce loading spinners and progress bars on long operations. Display user‑friendly error messages when backend calls fail.
  - Keep the canvas‑based viewer and annotation tools functional. Do not remove any existing extraction or search features.

- [ ] **Add responsive design:**
  - Incorporate basic media queries or use a CSS framework to support tablets and mobile devices. Focus on rearranging panels and enlarging touch targets.

- [ ] **Write/Update frontend tests:**
  - Adjust unit and integration tests to account for backend calls (mock or stub requests).
  - Ensure Playwright E2E tests still pass when run against the backend.

### 3. Security, Legal & Compliance

- [ ] Remove default credentials in `src/services/AuthManager.ts` and enforce proper authentication (see `PRODUCTION_READINESS_ASSESSMENT.md`).

- [ ] **Sanitise console output:**
  - Replace `console.log` statements with a proper logging service (e.g. wrap them in a logger that can be disabled in production). Use a Vite plugin to remove console calls from builds.

- [ ] **Add security headers** to your deployment (documented in `DEPLOYMENT_GUIDE.md`). Confirm that the container or server sets CSP, X‑Frame‑Options, X‑Content‑Type‑Options, Referrer‑Policy and Permissions‑Policy.

- [ ] Implement rate limiting both client‑side and server‑side.

- [ ] **Add legal documents:**
  - Create `LICENSE`, `PRIVACY.md`, `TERMS.md` and cookie consent components as described in the production readiness report.

### 4. Documentation & Final Steps

- [ ] **Update documentation:**
  - Revise `README.md` to clearly state the backend‑first architecture, how to set up the environment variables, and the recommended deployment steps.
  - Update or create `AI_SERVICE_ARCHITECTURE.md` summarising the new flow.
  - Mark security issues resolved in `SECURITY.md`.

- [ ] **Update this Exec Plan:**
  - As each task completes, mark it done (`[x]`) and briefly summarise what changed.

- [ ] **Final Verification:**
  - Run `npm test`, `npm run test:e2e`, `npm run lint` and `pytest` after all changes. All tests must pass.
  - Build the production frontend (`npm run build`) and verify that no API keys are present in the build output (grep for `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`).
  - Confirm that the live app functions as expected via manual exploratory testing (document upload, extractions, AI actions, results download, etc.).

## 📍 How to Use This Plan with Codex Web

1. Ensure `AGENTS.md` at the repo root includes guidelines on running tests (`npm test`, `pytest`, etc.), security constraints, and definitions of production readiness.

2. When launching a Codex Web session, reference this file explicitly in your prompt:
   > "Follow the tasks in `MODERNIZATION_EXECPLAN.md` to migrate the project to a backend‑first, production‑ready state. Prioritise tasks under 'Backend Integration & Security' and 'Frontend Refactor & UX'. Update the plan as you complete each item and ensure all tests pass."

3. Work in stages: implement a subset of tasks (e.g., AIService refactor), run tests, then move on to the next set. Use the plan as a checklist and update it with comments.

4. Do not commit large, sweeping changes without intermediate testing; keep changes focused and incremental.

---

**Last updated:** Nov 20 2025
