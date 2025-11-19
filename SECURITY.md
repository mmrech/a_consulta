# Security Policy

## Supported Versions

We actively support and provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in Clinical Extractor, please report it responsibly by following these steps:

### 1. Contact Us

Send a detailed report to: **security@clinicalextractor.local** (or create a private security advisory on GitHub)

Include in your report:
- **Description of the vulnerability**
- **Steps to reproduce** (proof-of-concept if possible)
- **Potential impact** (what can an attacker achieve?)
- **Affected versions**
- **Suggested fix** (if you have one)

### 2. Response Timeline

- **Initial Response:** Within 48 hours of report
- **Status Update:** Within 7 days (assessment of severity)
- **Fix Timeline:** Varies by severity (see below)
  - **Critical:** 1-7 days
  - **High:** 7-14 days
  - **Medium:** 14-30 days
  - **Low:** 30-90 days

### 3. What to Expect

1. **Acknowledgment:** We'll confirm receipt of your report
2. **Assessment:** We'll evaluate severity and impact
3. **Development:** We'll work on a fix (you may be invited to collaborate)
4. **Disclosure:** We'll coordinate public disclosure with you
5. **Credit:** We'll acknowledge your contribution (if desired)

## Security Best Practices

### For Users

1. **Environment Variables:**
   - Never commit `.env.local` to version control
   - Use strong, unique passwords for `VITE_DEFAULT_USER_PASSWORD`
   - Rotate API keys regularly

2. **API Keys:**
   - Keep `VITE_GEMINI_API_KEY` secure and private
   - Use API key restrictions in Google Cloud Console
   - Monitor API usage for anomalies

3. **Backend Authentication:**
   - Configure `VITE_DEFAULT_USER_EMAIL` and `VITE_DEFAULT_USER_PASSWORD` securely
   - Use HTTPS for all backend communications
   - Enable CORS restrictions on backend

4. **Data Privacy:**
   - Be cautious when uploading sensitive medical PDFs
   - Review export files before sharing (may contain PHI/PII)
   - Use localStorage encryption for sensitive data (future feature)

### For Developers

1. **Input Validation:**
   - All user inputs are sanitized via `SecurityUtils.sanitizeText()`
   - PDF files are validated before processing
   - Form inputs use strict validation rules

2. **XSS Prevention:**
   - No `innerHTML` usage without sanitization
   - All user-generated content is escaped
   - CSP headers should be configured (see PRODUCTION_READINESS_ASSESSMENT.md)

3. **API Security:**
   - Circuit breaker prevents API abuse
   - Rate limiting on backend requests
   - Retry logic with exponential backoff

4. **Error Handling:**
   - Sensitive information not exposed in error messages
   - Stack traces disabled in production builds
   - Error recovery prevents data loss

## Known Security Considerations

### 1. Frontend API Key Exposure ⚠️ CRITICAL

**Risk Level:** HIGH (10/10) - **Deploy Blocker for Production**

**Issue:** Gemini API keys loaded via `VITE_GEMINI_API_KEY` are embedded in the compiled JavaScript bundle and visible in browser DevTools. This is a fundamental limitation of frontend-only implementations using Vite's environment variable system.

**Location:** `src/services/AIService.ts:76-78`

**Why This Happens:**
- Vite bundles `VITE_*` environment variables into client-side JavaScript
- Variables prefixed with `VITE_` are intentionally exposed for frontend use
- No encryption or obfuscation can truly protect keys in client-side code
- Attackers can extract keys via browser DevTools, source maps, or bundle inspection

**Current Risk Assessment:**
```
✅ ACCEPTABLE FOR:
- Local development environments
- Personal projects and demos
- Educational/prototype applications
- Apps with strict API key restrictions enabled

❌ NOT ACCEPTABLE FOR:
- Production deployments with sensitive data
- Public-facing applications without restrictions
- Commercial products
- Healthcare/HIPAA-compliant applications
```

**Current Mitigations (Partial Protection):**
1. **API Key Restrictions (Google Cloud Console):**
   - Set HTTP referrer restrictions (e.g., `yourapp.com/*`)
   - Enable IP address allowlisting (if applicable)
   - Monitor API usage dashboard for anomalies
   - Set up billing alerts to detect abuse early

2. **Rate Limiting (Application Level):**
   - Circuit Breaker pattern (`CircuitBreaker.ts`) prevents cascade failures
   - Automatic backoff after 5 consecutive failures
   - 60-second recovery window

3. **Usage Monitoring:**
   - Track API call patterns in application logs
   - Alert on unusual spike in requests
   - Manual review of extraction logs

**Recommended Long-Term Solution: Backend Proxy**

The only secure solution is to move API key storage to the backend. See `BACKEND_MIGRATION_PLAN.md` for step-by-step implementation guide.

**Backend Proxy Architecture:**
```
Frontend → Backend API → Gemini API
(no key)    (key secure)  (authenticated)
```

Benefits:
- API key never exposed to client
- Server-side rate limiting and authentication
- Request validation and sanitization
- Centralized logging and monitoring
- Compliance with security best practices

**Interim Workaround (If Backend Not Feasible):**

1. **Enable All API Key Restrictions:**
   ```bash
   # Google Cloud Console → API & Services → Credentials
   # Edit your API key → Application restrictions
   - Set HTTP referrers: yourapp.com/*, localhost:3000/*
   - Enable quotas and rate limits
   - Set daily budget caps
   ```

2. **Use Firebase App Check (Alternative):**
   - Provides app attestation without backend
   - Validates requests come from legitimate app instances
   - Reduces (but doesn't eliminate) abuse risk

3. **Implement Client-Side Rate Limiting:**
   - Limit AI calls per session (already implemented via Circuit Breaker)
   - Add user confirmation before expensive operations
   - Cache results aggressively to reduce API calls

**Documentation References:**
- Implementation plan: `BACKEND_MIGRATION_PLAN.md` (to be created)
- Google Cloud API Key Best Practices: https://cloud.google.com/docs/authentication/api-keys
- Vite Environment Variables: https://vitejs.dev/guide/env-and-mode.html

**Status:** ⚠️ DOCUMENTED - Backend migration planned for v2.0

### 2. LocalStorage Data

Data is stored in browser localStorage without encryption:
- `clinical_extractions_simple` - Extraction history
- `clinical_extractor_annotations` - PDF annotations
- `clinical_extractor_crash_state` - Crash recovery data

**Mitigations:**
- Data is cleared on logout
- Users should clear browser data on shared computers
- Future: Add localStorage encryption option

### 3. PDF Processing

PDFs are processed entirely client-side using PDF.js:
- No server-side validation
- Malicious PDFs could exploit PDF.js vulnerabilities

**Mitigations:**
- PDF.js is kept up-to-date (current: 3.11.174)
- Sandboxed iframe for PDF rendering (future enhancement)
- File size limits enforced (100MB)

### 4. Backend Integration (Optional)

When backend is enabled, authentication uses JWT tokens:
- Tokens stored in memory (not localStorage)
- Auto-expiration after session
- Default credentials must be configured securely

**Mitigations:**
- Require strong passwords (see `.env.example`)
- Use HTTPS for all backend requests
- Implement token rotation (backend feature)

### 5. Dependency Vulnerabilities

**xlsx (SheetJS) Library:**
The application uses `xlsx@0.18.5` for Excel export functionality. This version has known vulnerabilities:

- **Prototype Pollution** (GHSA-4r6h-8v6p-xvw6) - High severity
- **ReDoS** (GHSA-5pgg-2g8v-p4x9) - High severity

**Risk Assessment:** ✅ **LOW** - Not exploitable in current use case

**Mitigations:**

- We only **GENERATE** Excel files (output-only), never **PARSE** user-uploaded files
- All data comes from trusted form inputs
- Vulnerabilities require malicious input files to exploit
- Monitored weekly for security patches
- See `DEPENDENCY_VULNERABILITIES.md` for detailed analysis

**If Excel Import Added:**

- Switch to `exceljs` library (no known vulnerabilities)
- Implement input sanitization and validation
- Run parsing in sandboxed Web Worker

## Security Audit History

| Date       | Type            | Severity | Status  | Notes |
|------------|-----------------|----------|---------|-------|
| 2025-11-19 | Self-Assessment | Medium   | Fixed   | Hardcoded credentials removed from AuthManager.ts |
| 2025-11-19 | Review          | Low      | Open    | 59 console.log statements in production code |
| 2025-11-19 | Review          | Medium   | Open    | Missing CSP headers |
| 2025-11-19 | Review          | Low      | Open    | No HTTPS enforcement |

## Security Testing

Run security checks before deployment:

```bash
# 1. Dependency vulnerability scan
npm audit

# Fix vulnerabilities
npm audit fix

# 2. TypeScript strict mode check
npm run lint

# 3. Test suite (includes security tests)
npm test

# 4. Check for exposed secrets
git secrets --scan

# 5. Build and verify (console.log removal)
npm run build
```

## Responsible Disclosure

We follow a **90-day disclosure policy**:

1. **Day 0:** Vulnerability reported
2. **Day 0-7:** Assessment and acknowledgment
3. **Day 7-30:** Fix development and testing
4. **Day 30-60:** Patch release and user notification
5. **Day 60-90:** Coordinated public disclosure (if not already fixed)

If a fix takes longer than 90 days, we'll work with the reporter to determine appropriate disclosure timing.

## Security Champions

For questions about this security policy or to report issues:

- **GitHub Issues:** [github.com/your-org/clinical-extractor/issues](https://github.com)
- **Email:** security@clinicalextractor.local
- **Security Advisories:** [github.com/your-org/clinical-extractor/security/advisories](https://github.com)

## Acknowledgments

We thank the following researchers for responsibly disclosing vulnerabilities:

- *Your name could be here! Report responsibly and get credited.*

---

**Last Updated:** November 19, 2025
**Policy Version:** 1.0
