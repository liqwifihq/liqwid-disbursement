Backend: NestJS API

Start:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
# in another shell
npm run worker
```

Endpoints:
- POST /files/upload  -> multipart file upload, returns preview
- POST /files/create-batch -> { rows }; actor comes from authenticated proxy headers
- GET /batches -> PII-minimized batch summaries
 - GET /batches/:id -> get batch and its transactions
- POST /batches/:id/approve -> approve a ready batch
- POST /batches/:id/disburse -> enqueue an approved batch
 - POST /reconcile/batch -> { batchId }  // reconcile transactions with Korapay

Notes:
- `PAYMENT_MODE` must be explicitly `simulation` or `live`. Simulation never calls Kora or reports settlement success. Live mode calls Kora; a Kora test key uses their sandbox, while a Kora live key can transfer real funds.
- `DATA_ENCRYPTION_KEY` encrypts bank account numbers with AES-256-GCM.
- DB synchronization is development-only and must be disabled in production.
- The API always requires a 32+ character `INTERNAL_API_TOKEN`. Kora webhooks remain public but fail closed unless live signature verification is configured.
- Queue payloads contain IDs only. The worker locks and reloads trusted payment data from PostgreSQL before calling Kora.
- Uploaded CSV files require recipient name, recipient email, account number, bank code, amount, and currency. The backend generates a unique, batch-scoped payment reference for every transaction.
- Provider-connected payouts enqueue a Kora status confirmation after 60 seconds. Non-final results retry once per minute for up to 15 attempts; the queried Kora status is used to finalize the transaction and batch.
- `DISCORD_SUCCESS_WEBHOOK_URL` receives confirmed-success alerts. `DISCORD_FAILURE_WEBHOOK_URL` receives failed-payment and unresolved-confirmation alerts. Both must be HTTPS Discord webhook URLs and must point to separate Discord channels.

## Deploying to an AWS server

The [GitHub Actions workflow](.github/workflows/deploy-aws.yml) builds and deploys this backend. The `backend` directory must be the root of its own GitHub repository so GitHub discovers `backend/.github/workflows/deploy-aws.yml` as the repository's workflow.

A push to `main` first builds the NestJS app and validates the production Compose file. It then uploads that exact backend revision to an EC2-style Linux host over SSH. On the server, the script builds production images, starts Redis, connects to the configured AWS PostgreSQL database, runs reviewed TypeORM migrations, and replaces the API and worker containers only after those steps succeed.

Prepare an Ubuntu EC2 instance with Docker Engine, the Docker Compose plugin, and an HTTPS reverse proxy such as Nginx. The API binds to `127.0.0.1:3000`; route backend API traffic and `/webhooks/korapay` to that address. Allow public inbound traffic only on ports 80/443 and restrict port 22 to trusted administrator or runner addresses.

Create the persistent server configuration (replace the path if needed):

```bash
sudo mkdir -p /opt/liqwifi-backend/shared
sudo chown -R "$USER":"$USER" /opt/liqwifi-backend
cp deploy/.env.example /opt/liqwifi-backend/shared/.env
chmod 600 /opt/liqwifi-backend/shared/.env
```

Fill every placeholder in the server-side `.env`. Set `DATABASE_URL` to the complete AWS RDS PostgreSQL URL and include `sslmode=require`. Percent-encode URL-reserved password characters in the URL. The RDS security group must allow PostgreSQL traffic from the backend server's security group. Keep `PAYMENT_MODE=simulation` until HTTPS, Kora credentials, and webhook delivery have been verified. For provider integration testing, use `PAYMENT_MODE=live` with a Kora test secret; replace it with a live secret only when real payouts are intended.

Create a GitHub `production` environment and add these secrets:

- `AWS_HOST`: the EC2 public DNS name or IPv4 address.
- `AWS_USER`: the SSH user, commonly `ubuntu`.
- `AWS_SSH_PORT`: optional; defaults to `22`.
- `AWS_DEPLOY_PATH`: for example `/opt/liqwifi-backend`.
- `AWS_SSH_PRIVATE_KEY`: a dedicated deployment private key.
- `AWS_SSH_KNOWN_HOSTS`: the server's pinned known-hosts line obtained through a trusted channel.

The SSH user must be able to run `docker compose` without an interactive `sudo` prompt and write to `AWS_DEPLOY_PATH`. GitHub environment protection rules can require approval before production deployment. Database, encryption, internal API, and payment-provider secrets stay in the server-side `.env`, not in GitHub Actions.
