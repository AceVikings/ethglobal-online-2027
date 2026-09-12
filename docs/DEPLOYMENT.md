# Deployment

The lowest-cost deployment is a free Render Static Site for the frontend and a
scale-to-zero Google Cloud Run service for the API. At hackathon traffic this
should remain inside Cloud Run's monthly free tier. Unlike a VM, it does not
bill for an idle always-on process under request-based billing.

## Frontend: Render Static Site

The repository's `render.yaml` defines the static site. Connect this repository
in Render. Render builds `packages/web`, proxies `/api/*` to Cloud Run, and
rewrites all remaining application routes to `index.html`. The browser therefore
uses a same-origin API path and does not need a public build-time environment
variable.

## API: Google Cloud Run

The `Deploy API to Cloud Run` workflow builds an immutable container in Artifact
Registry and deploys it after tests pass on `main`. Authentication uses GitHub
OIDC and Workload Identity Federation; there is no long-lived Google service
account key in GitHub.

The service uses one vCPU, 512 MiB memory, zero minimum instances, and a maximum
of two instances. Its `/data` mount is a read-only Cloud Storage bucket holding
the completed, chain-confirmed caretaker state.

Repository variables required by the workflow are:

```text
GCP_PROJECT_ID=ethonline-476311
GCP_REGION=us-central1
GCP_CLOUD_RUN_SERVICE=conformance-desk-api
GCP_ARTIFACT_REPOSITORY=conformance-desk
GCP_STATE_BUCKET=ethonline-476311-conformance-desk-state
GCP_RUNTIME_SERVICE_ACCOUNT=conformance-desk-runtime@ethonline-476311.iam.gserviceaccount.com
GCP_DEPLOY_SERVICE_ACCOUNT=github-conformance-deploy@ethonline-476311.iam.gserviceaccount.com
GCP_WORKLOAD_IDENTITY_PROVIDER=projects/<number>/locations/global/workloadIdentityPools/github/providers/ethglobal-online-2027
X402_PAY_TO=0.0.<seller>
ATS_SECURITY_ID=0.0.<security>
HCS_TOPIC_ID=0.0.<topic>
CORS_ALLOWED_ORIGIN=https://your-frontend.onrender.com,http://localhost:5173,http://127.0.0.1:5173
```

`graph-studio-key` and `verdict-signer-key` live in Google Secret Manager and
are exposed only to the Cloud Run runtime identity. Never add them to the
frontend or commit a populated `.env` file.

The API projects completed, chain-confirmed caretaker state from the mounted JSON
file. The caretaker itself is currently a one-shot command, not a hosted queue
worker. For the hackathon demo, run the real caretaker flow and upload its
completed state file to the bucket. A continuously autonomous production system
should use durable transactional storage and invoke the caretaker through an
authenticated Cloud Run Job or task queue.

## Publication

Publish only after the current tree and reachable Git history pass the secret
scan. If the history is rewritten to remove obsolete development artifacts,
update any commit-pinned documentation links first and protect the replacement
`main` immediately after the force push.

Before publishing the snapshot:

```bash
npm test
npm run build --workspace @conformance-desk/web
gitleaks dir . --redact --no-banner
```

Pricing and platform behavior should be rechecked before deployment:

- [Render static sites](https://render.com/docs/static-sites)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud Run overview](https://cloud.google.com/run/docs/overview/what-is-cloud-run)
- [Cloud Storage volume mounts](https://cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts)
