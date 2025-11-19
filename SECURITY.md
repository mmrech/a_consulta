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

### 1. Client-Side API Keys

⚠️ **Note:** Gemini API keys are exposed in client-side code (environment variable `VITE_GEMINI_API_KEY`). This is a Vite limitation.

**Mitigations:**
- Use API key restrictions in Google Cloud Console
- Limit API key to specific HTTP referrers (your domain)
- Monitor API usage for abuse
- Consider backend proxy for production (see `BackendProxyService`)

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
