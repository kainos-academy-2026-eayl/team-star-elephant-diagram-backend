# Technologist Academy Node Service Template

A starter repository for building Node.js HTTP services in the Technologist Academy.

It gives you an API-only Express service with TypeScript and a production build. `GET /health` reports service status and the current timestamp. There is no home page: `GET /` returns 404.

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| [nvm](https://github.com/nvm-sh/nvm) | latest | Required. Manages your Node version per project. |
| Node.js | 22 | Pinned in [.nvmrc](.nvmrc). Install it with nvm, not with a system installer. |
| npm | 10+ | Ships with Node 22. |

Install nvm, then from the repository root run:

```sh
nvm install   # reads .nvmrc and installs Node 22
nvm use       # switches this shell to Node 22
```

Run `nvm use` every time you open a new terminal in this project, or configure your shell to do it automatically. Using a different Node version may cause confusing build failures.

Verify you are on the right version:

```sh
node -v   # should print v22.x.x
```

## Quick start

```sh
nvm use
npm ci             # install exact dependency versions from package-lock.json
cp .env.example .env
# Configure DATABASE_URL and all three signing secrets (see Authentication below).
npm run dev        # start the service with hot reload
```

Then in another terminal:

```sh
curl http://localhost:3001/health
# {"status":"UP","time":"2026-10-15T14:30:00.000Z"}
curl http://localhost:3001/
# 404 Not Found
```

The health check's `time` is the current UTC time in ISO 8601 format.

## Frontend integration

Run this API on port `3001` and the sibling frontend on port `3000`.
Start PostgreSQL with `docker compose up -d`, apply the checked-in migrations
with `npm run db:deploy`, then start the backend with `npm run dev`.
The frontend's `.env` needs `API_BASE_URL=http://localhost:3001`.

The frontend server forwards registration and login as JSON to `POST /register`
and `POST /login`, and loads products from `GET /products`.
The catalogue reads the Prisma `Product` table; an empty table returns `[]`.
Prices are stored as decimal pounds and returned as JSON numbers, displayed as GBP.
Login creates a 15-minute access JWT and a seven-day rotating refresh session.
See [Authentication](#authentication) for secrets, the new database
migration, HTTPS requirements, `/auth/refresh` and logout behavior.
The catalogue remains public. Basket operations are not implemented by this API.

### Seed the product catalogue

After configuring `DATABASE_URL` and applying migrations, run:

```sh
npm run db:seed
```

The seed inserts 50 fictional hardware products: ten each in Laptops, Monitors,
Keyboards, Mice and Headsets. [prisma/products.ts](prisma/products.ts) exports a
typed array suitable for `prisma.product.createMany({ data: products })`.
Prices are representative GBP amounts, not live retail offers. Unsplash category
stock photos are shared within each category and illustrate the hardware type;
they are not photographs of the exact products.

Products are inserted only when the product table is empty. Existing products
are left unchanged, so an existing catalogue (including the old sample products)
will not be replaced or topped up. The existing user seed is preserved.

Use `npm ci` rather than `npm install`. It installs the exact versions recorded in `package-lock.json`, so everyone on the team runs identical dependencies. Use `npm install` only when you are deliberately adding or upgrading a package.

## Authentication

Customer and admin authentication use standard HS256 JWTs through `jose`:
15-minute access tokens and rotating refresh sessions with an **absolute
seven-day lifetime from login**. Refreshing does not extend that lifetime.

### Setup

1. Generate three independent random secrets with `openssl rand -hex 32`, one
   for each variable in your untracked `.env`:
   - `JWT_SECRET`: customer access tokens.
   - `ADMIN_ACCESS_TOKEN_SECRET`: admin access tokens.
   - `ADMIN_REFRESH_TOKEN_SECRET`: refresh tokens.
   Secrets must contain at least 32 bytes; access and refresh secrets must
   differ. Keep them stable across restarts and instances. Missing secrets
   fail startup in every environment. Set `NODE_ENV=production` in production.
2. Run `npm run db:generate`. For a new database, apply the checked-in migrations
   with `npm run db:deploy`. For an existing database whose schema matches the
   pre-auth baseline, first back it up and record that baseline without running
   its SQL:

   ```sh
   npx prisma migrate resolve --applied 20261029130000_baseline
   npm run db:deploy
   ```

   `migrate resolve` only records the baseline as applied; it does not modify
   existing data. Verify the baseline schema matches before marking it applied,
   and do not reset a database to resolve drift.
   The `20261029135000_align_auth_schema` migration renames legacy `User.id`
   to `userId` and `AdminUser.adminID` to `adminId`, adds the four user address
   fields, and fills missing addresses with empty strings. It preserves
   existing accounts, IDs, password hashes, addresses and reset-token columns.
   The baseline creates the initial commerce schema; the following migration
   creates `RefreshSession`.
3. Serve the frontend over **HTTPS**, including local browser testing.
   In the sibling frontend, run `npm run dev:cert` and configure:

   ```ini
   TLS_CERT_FILE=.certs/localhost.pem
   TLS_KEY_FILE=.certs/localhost-key.pem
   ```

   Restart the frontend and open **https://localhost:3000/login**.
   The generated certificate is self-signed; accept its warning only for your
   localhost development server, or use a trusted local development certificate.
   Set `FRONTEND_BASE_URL=https://localhost:3000` in the backend `.env`.
   A TLS proxy is also supported; preserve the public Host header. See the
   frontend README for details. Keep backend HTTP traffic on a trusted private
   connection rather than exposing it across an untrusted network.
   If the backend receives requests through a proxy, set `TRUSTED_PROXY_IPS`
   to a comma-separated list of that proxy's IP addresses or narrow CIDR ranges.
   Configure the proxy to set or append the actual client address in
   `X-Forwarded-For`, not pass client-supplied forwarding values through
   unchanged. Express will only use forwarding headers from configured proxy
   addresses. Leave this unset when the backend is accessed directly, and
   never trust all proxy addresses.

### API

| Backend endpoint | Behavior |
| --- | --- |
| `POST /login` | Customer JSON credentials; returns `accessToken`, `expiresIn: 900`, and legacy `token` alias. |
| `POST /admin/login` | Admin JSON credentials; returns `accessToken`, `expiresIn: 900`, and public admin details. |
| `POST /auth/refresh` | Exchanges the refresh cookie for a new access token and rotates the cookie. |
| `POST /auth/logout` | Revokes the refresh session and expires the refresh cookie. |
| `GET /profile` | Requires a customer access token in `Authorization: Bearer <token>`. |
| `GET /admin/me` | Requires an admin access token in the header. |
| `GET /admin` | Returns authenticated staff identity; dashboard metrics are not implemented. |
| `GET /admin/users?search=&page=` | Admin only. Lists customers (20 per page, newest first); `search` matches name or email, case-insensitive. |
| `GET /admin/users/:id` | Admin only. Customer summary, 5 most recent orders, and basket summary (always empty until baskets are persisted). |
| `POST /admin/users/:id/suspend` | Admin only. Sets the customer to `suspended`; suspended customers get the normal invalid-credentials response at `POST /login`. |
| `POST /admin/users/:id/reactivate` | Admin only. Sets the customer back to `active`. |

`POST /admin/logout` remains a compatibility alias. The refresh endpoint is
`/auth/refresh`, not `/admin/refresh`. Customer order history is not implemented;
the profile response explicitly flags that limitation.

API clients retain the refresh cookie and send access tokens as Authorization
headers. On the frontend, use `/login` for customers or `/admin/login` for staff,
and visit `/profile` or `/admin` to exercise protected page loading.
`POST /logout` on the frontend revokes the refresh session and clears both
browser credentials.

### Persistence and security

- The refresh cookie is always `HttpOnly; Secure; SameSite=Strict; Path=/`,
  with a seven-day expiry. Plain HTTP is not supported for authenticated
  browser sessions; Secure is never disabled for development.
- The Express/Nunjucks frontend is server-rendered, not a browser SPA. It keeps
  the access token in an additional Secure, HttpOnly, Strict cookie and forwards
  it to the API **as an Authorization header**. It preserves the refresh
  cookie's expiry and attributes.
- On a protected page request, an expired or missing access token triggers one
  refresh-and-retry. Reloads and browser restarts can restore login while the
  seven-day session is valid. Customer and admin login share cookie names, so
  logging into one replaces the other in that browser.
- Verification checks HS256, issuer, audience, required claims, expiration,
  account kind and token purpose. Access tokens cannot act as refresh tokens,
  or vice versa. Deleted accounts cannot refresh.
- PostgreSQL stores only a SHA-256 hash of the current refresh token, plus
  session/account identifiers, expiration and revocation timestamps.
  Rotation uses an atomic conditional update. Consumed tokens cannot rotate
  again; detected reuse revokes the session.
- The frontend coalesces in-flight refreshes per process. Concurrent requests
  across instances or tabs may still force re-login if they present an
  already-consumed token.
- Logout revokes refresh credentials. Already-issued access tokens can remain
  valid for their remaining **15 minutes**; logout is not immediate access
  revocation.
- Refresh and protected profile responses use `Cache-Control: no-store`.
  HttpOnly prevents JavaScript reading cookies, but does not stop XSS making
  authenticated requests. SameSite mitigates CSRF, not XSS. The frontend also
  rejects cross-origin login/logout POSTs without trusting client-supplied
  forwarding headers.

Deployments replacing the old custom two-part tokens require users to log in
again. Prune expired/revoked database sessions as an operational maintenance task.

Run `npm test` and `npm run build` in both repositories. Authentication tests
cover JWT compatibility, lifetimes, account/purpose separation, cookie flags,
session restoration, rotation/replay, logout and failed refreshes. Backend unit
tests inject a session repository rather than mutate a developer database.

## Making it your own

After clicking **Use this template** on GitHub and creating your own repository:

1. Clone your new repository and run the quick start steps above.
2. Update the identity fields in [package.json](package.json):
   - `name` — your service name in kebab-case, e.g. `booking-service`
   - `description` — one line describing what your service does
   - `author` and `license`
   - `version` — reset to `0.1.0` if you prefer to start fresh
3. Replace this README with documentation for your own service.
4. Update `PORT` in [.env.example](.env.example) if your service should default to a different port, and keep it in sync with your own `.env`.
5. Delete or replace the sample `/health` route once you have real endpoints — though keeping a health check is good practice for deployments.

Never commit your `.env` file. It is already listed in [.gitignore](.gitignore); `.env.example` is the committed template that documents which variables are needed.

## Scripts

| Script | Command | What it does |
| --- | --- | --- |
| `npm run dev` | `tsx watch` | Runs the service from TypeScript source and restarts on changes. Use this while developing. |
| `npm run typecheck` | `tsc` | Checks types without emitting files. |
| `npm run build` | `tsc`, `esbuild` | Type-checks and bundles the service into `dist/index.js`. |
| `npm run lint` | `biome lint .` | Runs recommended lint rules without changing files. |
| `npm test` | `node --import tsx --test` | Checks the health response and that the API-only root returns 404. |
| `npm start` | `node dist/index.js` | Runs the built output. Requires `npm run build` first. |
Before pushing, run `npm run build`, `npm run lint`, and `npm test`.

## Testing user login with Bruno

The [Bruno collection](bruno/bruno.json) tests `POST /login` and includes a registration
request to create its test account.

1. Start local Postgres and apply migrations using the commands under
   [User registration](#user-registration).
2. Run `npm run dev`.
3. In Bruno, choose **Open Collection** and select the [bruno folder](bruno/).
4. Select the **Local** environment. Change `baseUrl` in
   [Local.bru](bruno/environments/Local.bru) if your API uses a different port.
5. Run the collection in its numbered order. The first request creates a unique
   test account and sets runtime email variables for the remaining requests.
   Each full run creates one account in the selected database; use a development
   or test database, not production.

The requests check successful login (`200`), wrong password and unknown user
(`401`), and invalid email, empty password, missing fields and malformed JSON
(`400`). Each request includes assertions in Bruno's **Tests** tab.

To test an existing account instead, open **Login successfully**, set `loginEmail`
and `loginPassword` in your local Bruno environment, and send that request without
running registration. If you already ran registration in this session, clear its
runtime `loginEmail` variable first because runtime variables override environment
variables. Do not commit real credentials. Login returns an access token and
sets the Secure, HttpOnly refresh cookie; see [Authentication](#authentication).

## CI and required merge checks

[The CI workflow](.github/workflows/ci.yml) runs on opened, reopened, and updated pull requests, and pushes to `main` or `master`, including merges. It uses Node from [.nvmrc](.nvmrc), installs locked dependencies, then builds, lints, and runs tests once. Any failed step fails the job.

**The workflow alone does not block merging.** A repository administrator must configure GitHub protection in both the frontend and backend repositories:

1. Push the workflow and let it run once so **Build, lint and test** appears as a check.
2. Open **Settings > Branches > Add classic branch protection rule**.
3. Set the branch pattern to `main`; repeat for `master` if used.
4. Enable **Require a pull request before merging**.
5. Enable **Require status checks to pass before merging** and select **Build, lint and test** from GitHub Actions.
6. Enable **Require branches to be up to date before merging** and **Do not allow bypassing the above settings**, then save.

Preserve existing protections. If an old CI check is required, replace it with the new check after its first run. Do not add bypass permissions.

Verify enforcement with a temporary PR containing a deliberately failing test: CI must fail and GitHub must block merging. Fix the test and confirm CI passes before merging.

## Project structure

```
.
├── src/
│   ├── index.ts          # entry point: config, server startup, shutdown
│   └── app.ts            # builds the Express app and registers routes
├── test/app.test.mjs     # endpoint tests
├── .env                  # your local secrets and config (not committed)
├── .env.example          # template listing required env variables
├── .github/              # GitHub configuration
├── .gitignore            # files git should ignore
├── .npmrc                # pins the public npm registry for this project
├── .nvmrc                # the Node version this project uses
├── package.json          # project metadata, scripts and dependencies
├── package-lock.json     # exact dependency versions, committed
└── tsconfig.json         # TypeScript compiler and type-checking options
```

Generated folders — `node_modules/` and `dist/` — are ignored by git and safe to delete and regenerate.

### Why `app.ts` and `index.ts` are separate

[src/app.ts](src/app.ts) creates and configures the Express app but never starts listening. [src/index.ts](src/index.ts) reads configuration and starts the server. Keeping those responsibilities separate makes route registration independent from server startup.

## Adding a new route

Say you want a `GET /bookings` endpoint.

**1. Create the router** in `src/controllers/bookings.ts`:

```ts
import { Router, type Request, type Response } from 'express'

export const bookingsRouter = Router()

bookingsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ bookings: [] })
})
```

**2. Register it** in [src/app.ts](src/app.ts):

```ts
import { bookingsRouter } from './controllers/bookings'

// inside createApp(), before `return app`
app.use('/bookings', bookingsRouter)
```

Imports do not need a `.js` extension — this project is configured for bundler-style module resolution.

**3. Verify:**

```sh
npm run typecheck
npm run build
```

If your route reads a JSON request body, add `app.use(express.json({ limit: '100kb' }))` in `createApp()` before your routes.

## User registration

`POST /register` creates a user account.

Registration and login routes are defined together in [src/controllers/userController.ts](src/controllers/userController.ts).

```sh
docker compose up -d     # start local Postgres
npm run db:migrate       # apply Prisma migrations (creates the User table)
curl -X POST http://localhost:3001/register \
  -H 'content-type: application/json' \
  -d '{"forename":"Ada","surname":"Lovelace","email":"ada@example.com","password":"correct-horse"}'
# 201 {"status":"created"}
```

| Status | When |
| --- | --- |
| `201` | Account created. Response body is `{"status":"created"}`. |
| `400` | Body fails Zod validation (missing, blank or over-100-character forename/surname, invalid email, password shorter than 8 or longer than 128 characters, malformed JSON), or the email is already registered. |
| `500` | Unexpected server error, such as the database being unavailable. |

- Forenames and surnames are trimmed. `created_at` and `modified_at` are both set to the registration time.
- Emails are trimmed and lower-cased, and `User.email` has a unique constraint, so the same address can't be registered twice, even by concurrent requests.
- Passwords are hashed locally with argon2id via `argon2` (OWASP minimum parameters: 19 MiB memory, 2 iterations, parallelism 1). Only the one-way hash is stored, and no external identity provider is used.

## Configuration

Environment variables are loaded from `.env` by [dotenv](https://github.com/motdotla/dotenv) at startup.

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | yes | Port the service listens on. The service exits at startup if it is missing or invalid. |
| `DATABASE_URL` | yes | Postgres connection string used by Prisma, e.g. `postgresql://dev:dev@localhost:5432/app_dev`. |

The server binds to `0.0.0.0` so it is reachable from outside a container. Add new variables to both your `.env` and [.env.example](.env.example).

## Troubleshooting

**`Cannot find module` or unexpected type errors** — you may be on the wrong Node version. Run `nvm use`, then `rm -rf node_modules && npm ci`.

**`PORT environment variable is not set`** — you have not created your `.env`. Run `cp .env.example .env`.

**`EADDRINUSE`** — another process is already using that port. Stop it, or change `PORT` in `.env`.

**`npm start` fails with a missing file** — run `npm run build` first to generate `dist/`.
