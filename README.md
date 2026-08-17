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
- POST /files/create-batch -> { name, rows }; actor comes from authenticated proxy headers
- GET /batches -> PII-minimized batch summaries
 - GET /batches/:id -> get batch and its transactions
- POST /batches/:id/approve -> approve a ready batch
- POST /batches/:id/disburse -> enqueue an approved batch
 - POST /reconcile/batch -> { batchId }  // reconcile transactions with Korapay

Interactive OpenAPI documentation is available at `/docs`. Click **Authorize** and enter the configured `INTERNAL_API_TOKEN` to call protected endpoints.

Notes:
- `PAYMENT_MODE` must be explicitly `simulation` or `live`. Simulation never calls Kora or reports settlement success. Live mode calls Kora; a Kora test key uses their sandbox, while a Kora live key can transfer real funds.
- `DATA_ENCRYPTION_KEY` encrypts bank account numbers with AES-256-GCM.
- DB synchronization is development-only and must be disabled in production.
- The API always requires a 32+ character `INTERNAL_API_TOKEN`. Kora webhooks remain public but fail closed unless live signature verification is configured.
- Queue payloads contain IDs only. The worker locks and reloads trusted payment data from PostgreSQL before calling Kora.
- Uploaded CSV files require recipient name, recipient email, a 10-digit account number, bank code, amount, and currency. The backend generates a unique, batch-scoped payment reference for every transaction.
- Provider-connected payouts enqueue a Kora status confirmation after 60 seconds. Non-final results retry once per minute for up to 15 attempts; the queried Kora status is used to finalize the transaction and batch.
- `DISCORD_SUCCESS_WEBHOOK_URL` receives confirmed-success alerts. `DISCORD_FAILURE_WEBHOOK_URL` receives failed-payment, unresolved-confirmation, and background-worker error alerts. Both must be HTTPS Discord webhook URLs and must point to separate Discord channels.

## Deploying to an AWS server

The workflow is [.github/workflows/deploy-aws.yml](.github/workflows/deploy-aws.yml). It deploys every push to `main`, runs database migrations, and starts the API, Redis, and payment worker.

It assumes:

- this `backend` directory is the root of the GitHub repository;
- the EC2 SSH user is `ubuntu` and SSH uses port 22;
- Docker and Docker Compose are installed;
- `ubuntu` can run `docker compose` without `sudo`.

Add only these repository secrets under **GitHub > Settings > Secrets and variables > Actions**:

- `AWS_HOST`: the EC2 public IP address or public DNS name.
- `AWS_SSH_PRIVATE_KEY`: the complete private SSH key, including its BEGIN/END lines.
- `PRODUCTION_ENV`: the complete multiline production `.env`. Use [.env.example](.env.example) as the list of variables and replace every placeholder.

No `AWS_DEPLOY_PATH` or `deploy` folder is needed. The workflow creates `/home/ubuntu/liqwifi-backend` and writes its `.env` from `PRODUCTION_ENV`.

Push to `main` to deploy, or open the repository's **Actions > Deploy backend > Run workflow** page to run it manually.

The API listens on `127.0.0.1:3000`. Configure Nginx or another HTTPS reverse proxy to send API requests and `/webhooks/korapay` to that address.
