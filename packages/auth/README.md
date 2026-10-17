# @rr/auth

Sign-in adapters: the in-memory mock used by the design gallery and tests (same one-time-code rules as the real thing), and the email senders.

The real, working sign-in (passwords, codes, sessions) is the built-in provider in `@rr/server`. Authgate, when its protocol is known, becomes one more implementation of the same `AuthProvider` interface.
