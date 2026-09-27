# Vercel deployment adaptation

Preserve the existing local Node.js 24 launcher, SQLite data, UI locales, and voice behavior while adding a cloud deployment target for personal use.

1. Make storage asynchronous with interchangeable local SQLite and hosted Turso connections. Preserve data and use database leases to coordinate one active conversation across instances.
2. Restore active conversations after WebSocket disconnects using persisted messages; explicit end remains distinct from transport loss. Stop stale audio and provider work before resuming.
3. Add cloud HTTP/WebSocket addressing, access protection, private Blob storage, and fail-closed environment validation. Keep local behavior available without cloud credentials.
4. Package the backend for Vercel Services alongside the native Next.js frontend. Exclude credentials and user data from container build context.
5. Verify existing behavior plus storage concurrency, access boundaries, cloud routing, uploads, and reconnect state transitions. Run Node.js 24 typecheck, lint, tests, and production build. Document any Docker/cloud checks unavailable locally.

No live resources are provisioned or published by this code migration. Cloud validation uses local test stores and mocked provider endpoints until account credentials are configured.
