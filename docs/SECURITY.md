# Security

Frontend code can't be made uncopyable. Protection is server-side: authz and business rules on the server, nothing sensitive in the client, CSP/security headers, minified bundles with no public source maps, CSRF, rate limiting, upload validation, separate upload domain, UPI encrypted at rest and masked outside the payout screen, admin permission check against the DB on every request, audit log for every admin action.

Sales screenshots can contain customer data: private bucket, short-lived signed URLs, retention policy.
