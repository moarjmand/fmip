# deploy/certs

Caddy reads `origin.pem` and `origin.key` from here (`deploy/Caddyfile`).
Both files are git-ignored; only this note is tracked.

- **VPS:** the Cloudflare origin certificate and its key, created in the
  Cloudflare dashboard (SSL/TLS → Origin Server → Create Certificate, RSA,
  15 years, the apex and `*.` host names). Paste the certificate into
  `origin.pem` and the private key into `origin.key`; `chmod 600 origin.key`.
  Runbook: `docs/09-deploy.md`, step 4.
- **Laptop rehearsal:** `deploy/verify-rollout.sh` generates a self-signed
  pair for `localhost` when none is present.
