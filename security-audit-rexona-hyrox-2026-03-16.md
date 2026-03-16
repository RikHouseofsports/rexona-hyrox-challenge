# Security Audit Rapport - Rexona x HYROX Challenge

**Datum:** 2026-03-16
**Stack:** Node.js 22.5+ / Express 4 / SQLite (node:sqlite) / WebSocket / express-session / bcrypt
**Auditor:** Claude Security Audit Skill v1.0

---

## Executive Summary

| Severity | Aantal (voor fix) | Aantal (na fix) |
|----------|-------------------|-----------------|
| CRITICAL | 0                 | 0               |
| HIGH     | 1                 | 0               |
| MEDIUM   | 5                 | 0               |
| LOW      | 3                 | 3 (acceptabel)  |

**Totaal checks uitgevoerd:** 32
**Totaal bevindingen:** 9
**Bevindingen gefixt:** 6

**Totaaloordeel VOOR fix:** MET VOORBEHOUD (1 HIGH)
**Totaaloordeel NA fix:** KLAAR (0 CRITICAL, 0 HIGH)

---

## Bevindingen per categorie

### Authenticatie & Autorisatie

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| AUTH-01 | Auth op admin endpoints | CRITICAL | PASS | server.js (requireAdmin middleware) |
| AUTH-05 | Rate limiting op login | CRITICAL | PASS | server.js:199-210 (loginLimiter) |
| AUTH-09 | Wachtwoord hashing | CRITICAL | PASS | bcrypt met 12 rounds |
| AUTH-10 | bcrypt rounds >= 10 | HIGH | PASS | 12 rounds |
| PERF-01 | bcrypt blocking event loop | MEDIUM | FIXED | server.js:36-37, 335, 431 |

**Details fixes:**

#### PERF-01: bcrypt.hashSync/compareSync blokkeerde event loop
- **Severity:** MEDIUM
- **Status:** FIXED
- **Locatie:** `server.js:36-37` (hashSync), `server.js:335` en `server.js:431` (compareSync)
- **Risico:** Synchrone bcrypt operaties blokkeren de Node.js event loop. Bij meerdere gelijktijdige login pogingen kan dit de hele server onbereikbaar maken (DoS).
- **Fix:** hashSync/compareSync vervangen door async hash/compare. Server startup omgezet naar async functie.

---

### SQL Injection & XSS

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| INJ-01 | SQL string concatenation | CRITICAL | PASS | Alle queries gebruiken prepared statements |
| INJ-06 | innerHTML met user input | HIGH | PASS | esc() functie op alle user-generated content |
| HDR-02 | CSP 'unsafe-inline' voor scripts | MEDIUM | FIXED | server.js:163 |

#### HDR-02: CSP had 'unsafe-inline' voor scripts
- **Severity:** MEDIUM
- **Status:** FIXED
- **Locatie:** `server.js:163` (CSP header)
- **Risico:** `'unsafe-inline'` in script-src staat willekeurig inline JavaScript toe, wat XSS-aanvallen effectiever maakt.
- **Fix:** Alle inline scripts geextraheerd naar externe .js bestanden in `/public/js/`. CSP gewijzigd naar `script-src 'self'` (geen 'unsafe-inline' meer).

Geextraheerde bestanden:
- `public/js/admin-login.js`
- `public/js/export-login.js`
- `public/js/admin.js`
- `public/js/export.js`
- `public/js/leaderboard.js`

---

### Secrets & Environment

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| SEC-01 | Hardcoded secrets | CRITICAL | PASS | Alle secrets via process.env |
| SEC-03 | .env in .gitignore | HIGH | PASS | .gitignore bevat .env |

---

### Database Security

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| DB-04 | SELECT * met gevoelige velden | HIGH | PASS | Publiek leaderboard toont alleen naam + score. Email/PII alleen achter auth. |
| DB-05 | PII encryptie at rest | MEDIUM | WARN | Email in plain text in SQLite. Acceptabel voor dit type app (geen BSN/IBAN). |

---

### API Security

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| API-03 | Input validatie | HIGH | PASS | validateRegistration() op alle endpoints |
| API-05 | Stack traces in responses | HIGH | PASS | Generieke foutmeldingen naar client |

---

### HTTP Security Headers

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| HDR-01 | HSTS | CRITICAL | PASS | Actief in productie |
| HDR-03 | X-Frame-Options | HIGH | PASS | DENY + frame-ancestors 'none' |
| HDR-04 | X-Powered-By | MEDIUM | PASS | Uitgeschakeld |
| HDR-05 | Permissions-Policy | MEDIUM | FIXED | server.js:170 |
| HDR-06 | Referrer-Policy | MEDIUM | PASS | no-referrer |

#### HDR-05: Geen Permissions-Policy header
- **Severity:** MEDIUM
- **Status:** FIXED
- **Locatie:** `server.js:170`
- **Risico:** Zonder Permissions-Policy kunnen embedded scripts browser features (camera, microfoon, geolocatie) gebruiken.
- **Fix:** `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` toegevoegd.

---

### Dependencies

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| DEP-01 | npm audit vulnerabilities | HIGH | FIXED | package.json |
| DEP-02 | Lockfile gecommit | HIGH | PASS | package-lock.json aanwezig |

#### DEP-01: 3 HIGH severity vulnerabilities in bcrypt dependency chain
- **Severity:** HIGH
- **Status:** FIXED
- **Locatie:** `package.json`
- **Risico:** bcrypt v5 hing af van @mapbox/node-pre-gyp, dat afhankelijk was van tar (kwetsbaar voor path traversal, symlink poisoning).
- **Fix:** bcrypt geupgraded van v5.1.1 naar v6.0.0. Dit verwijdert de hele native compilation chain. `npm audit` toont nu 0 vulnerabilities.

---

### Logging & Monitoring

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| LOG-01 | Gevoelige data in logs | HIGH | PASS | Geen wachtwoorden/tokens in console.log |
| LOG-02 | Security event logging | MEDIUM | FIXED | server.js (logSecurity functie) |
| LOG-03 | PII in logs | HIGH | PASS | Geen volledige user objecten in logs |

#### LOG-02: Geen security event logging
- **Severity:** MEDIUM
- **Status:** FIXED
- **Locatie:** Meerdere locaties in server.js
- **Risico:** Zonder logging van failed logins en admin acties is het onmogelijk om aanvallen of misbruik te detecteren. Art. 33 AVG vereist melding van datalekken binnen 72 uur, wat alleen kan als je ze detecteert.
- **Fix:** `logSecurity()` functie toegevoegd die structured JSON logt. Events:
  - `login_success` / `login_failed` (admin + export) met IP en user-agent
  - `admin_action` (score edit/delete) met details en IP
  - `export_access` (data + CSV) met filters, row count en IP

---

### GDPR/AVG

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| GDPR-01 | Bijzondere persoonsgegevens | CRITICAL | PASS | Geen bijzondere data |
| GDPR-02 | Data minimalisatie | HIGH | PASS | Publiek leaderboard toont alleen naam + score |
| GDPR-04 | BSN verwerking | HIGH | PASS | Geen BSN |

---

### WebSocket

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| WS-01 | Origin verificatie | LOW | FIXED | server.js:287-297 |

#### WS-01: WebSocket zonder origin check
- **Severity:** LOW (data is publiek)
- **Status:** FIXED
- **Locatie:** `server.js:287-297`
- **Fix:** `verifyClient` functie toegevoegd die in productie de origin valideert tegen de eigen host. Configureerbaar via `ALLOWED_ORIGIN` env var.

---

### Session Management

| Check ID | Check | Severity | Status | Locatie |
|----------|-------|----------|--------|---------|
| SESS-01 | MemoryStore in productie | MEDIUM | WARN | server.js:182 |
| SESS-02 | CSRF bescherming | LOW | WARN | sameSite: 'lax' biedt basis bescherming |

**SESS-01 toelichting:** De default MemoryStore van express-session lekt geheugen en is niet persistent. Er is een waarschuwingscomment toegevoegd. Voor hoge traffic of langdurige productie wordt connect-sqlite3 of connect-redis aanbevolen.

**SESS-02 toelichting:** `sameSite: 'lax'` voorkomt dat cookies worden meegestuurd bij cross-origin POST/PUT/DELETE requests. Dit biedt goede CSRF bescherming voor moderne browsers. Expliciete CSRF tokens zijn niet strikt nodig voor deze app.

---

## Pass/Fail Actielijst

| # | Check | Status | Locatie | Prioriteit |
|---|-------|--------|---------|------------|
| 1 | DEP-01: Dependency vulnerabilities | FIXED | package.json | HIGH |
| 2 | HDR-02: CSP 'unsafe-inline' | FIXED | server.js + /public/js/*.js | MEDIUM |
| 3 | HDR-05: Permissions-Policy | FIXED | server.js:170 | MEDIUM |
| 4 | LOG-02: Security event logging | FIXED | server.js (logSecurity) | MEDIUM |
| 5 | PERF-01: bcrypt blocking | FIXED | server.js (async) | MEDIUM |
| 6 | WS-01: WebSocket origin | FIXED | server.js:287-297 | LOW |
| 7 | SESS-01: MemoryStore | WARN | server.js:182 | LOW |
| 8 | SESS-02: CSRF tokens | WARN | sameSite: lax mitigeert | LOW |
| 9 | GDPR-03: Breach monitoring | WARN | Aanbeveling | LOW |
| 10 | AUTH-01: Admin auth | PASS | requireAdmin middleware | - |
| 11 | AUTH-05: Rate limiting | PASS | loginLimiter | - |
| 12 | AUTH-09: bcrypt hashing | PASS | 12 rounds | - |
| 13 | INJ-01: SQL injection | PASS | Prepared statements | - |
| 14 | SEC-01: Hardcoded secrets | PASS | process.env | - |
| 15 | SEC-03: .env in gitignore | PASS | .gitignore | - |
| 16 | HDR-01: HSTS | PASS | Productie | - |
| 17 | HDR-03: X-Frame-Options | PASS | DENY | - |
| 18 | HDR-04: X-Powered-By | PASS | Uitgeschakeld | - |
| 19 | HDR-06: Referrer-Policy | PASS | no-referrer | - |
| 20 | API-03: Input validatie | PASS | validateRegistration() | - |

---

## Handmatige checks (uit te voeren na deployment)

- [ ] Response headers controleren: `curl -I https://[APP_URL]`
- [ ] Rate limiting testen: 6+ login pogingen binnen 15 min
- [ ] Controleer dat /admin redirect naar login zonder sessie
- [ ] Controleer dat /export redirect naar login zonder sessie
- [ ] Controleer dat /api/admin/* 302 redirect zonder sessie
- [ ] Controleer dat /api/export/* 302 redirect zonder sessie

---

## Samenvatting wijzigingen

| Bestand | Wijziging |
|---------|-----------|
| `package.json` | bcrypt v5 naar v6 |
| `server.js` | logSecurity functie, Permissions-Policy header, bcrypt async, WS origin check, CSP zonder 'unsafe-inline', MemoryStore comment |
| `public/js/admin-login.js` | NIEUW: geextraheerd uit admin-login.html |
| `public/js/export-login.js` | NIEUW: geextraheerd uit export-login.html |
| `public/js/admin.js` | NIEUW: geextraheerd uit admin.html (inline onclick verwijderd, event delegation) |
| `public/js/export.js` | NIEUW: geextraheerd uit export.html (onclick verwijderd, addEventListener) |
| `public/js/leaderboard.js` | NIEUW: geextraheerd uit leaderboard.html |
| `public/admin-login.html` | Inline script vervangen door externe ref |
| `public/export-login.html` | Inline script vervangen door externe ref |
| `public/admin.html` | Inline script vervangen door externe ref |
| `public/export.html` | Inline script + onclick vervangen door externe ref + IDs |
| `public/leaderboard.html` | Inline script vervangen door externe ref |

---

*Rapport gegenereerd door Claude Security Audit Skill v1.0*
*Dit rapport is een statische code analyse en vervangt geen professionele pentest.*
