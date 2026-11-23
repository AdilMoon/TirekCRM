# Market research and browser account recovery

Reviewed 23 November 2026.

## Changes and review

The research report compares public documentation for Jobber, Orderry, Planado, Housecall Pro and Bitrix24 Kazakhstan with the repository. It defines a target segment, a proposed advantage, acceptance criteria and pilot measurements. Commercial demand and willingness to pay are explicitly left for customer research.

Login now links to /reset-password. The page requests recovery, accepts a token from an email link and confirms the new password. RU, KK and EN labels use the existing translation system. Both Gmail and the development mailbox expose the browser link. Existing API endpoints retain their contracts.

Reviewed malformed and expired tokens, hidden account existence, unavailable delivery, cancellation of status loading, mismatched passwords and duplicate confirmation. The token travels in the fragment, is removed from the URL on mount, and remains in component memory. Password confirmation uses the existing POST API and Origin checks. The server continues to hash tokens, expire them, revoke sessions and record an audit event atomically.

Next.js was pinned from 16.4.3 to 16.4.6 using the npm registry audit's available patch. Package and lockfile versions agree. The updated production build completed.

The subsequent audit also identified Effect through @prisma/config. A scoped npm override selects Effect 3.22.1, the patched release for [GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw). It preserves Prisma 7.10.1. Prisma generation, migration deployment and the mail/recovery integrations were checked after the override took effect.

## Verification

- All 32 existing unit and localisation checks passed.
- All 20 mail and recovery integration checks passed against a newly created loopback PostgreSQL database. Fixtures were scoped to test organisations. Mail delivery used local fixtures and a test transport.
- All three Microsoft Edge browser checks passed against the updated production build. They exercise login navigation, the generic email response, mismatch validation, an expired-token response, successful confirmation, fragment removal, unavailable delivery and a 390 px layout. Their API responses are controlled fixtures. The integration suite separately verifies actual account and session changes.
- The final production dependency audit reported zero known vulnerabilities on 23 November 2026. This records the registry result at review time.
- Structure and translation checks cover the new components. Staged-file inspection excludes credentials, development mail, the QA database and generated files.

## Operational limits

Docker Engine was unavailable during this work. The updated source was built and tested with a local Node server. The Docker deployment needs rebuilding when the engine is running. A live Gmail message and a public-domain link were outside this verification. Real delivery depends on the existing Gmail configuration and a WEB_ORIGIN reachable by the recipient.

The single-page recovery token lives in memory. Reloading after the fragment has been cleared requires a fresh link. The page provides a link to request one.
