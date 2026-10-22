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
and `POST /login`, and loads products from `GET /product_catalogue`.
The catalogue reads the Prisma `Product` table; an empty table returns `[]`.
Prices are stored as decimal pounds and returned as JSON numbers, displayed as GBP.
Login validates credentials only: it does not create a session or protect the
catalogue. Basket operations are not implemented by this API.

Use `npm ci` rather than `npm install`. It installs the exact versions recorded in `package-lock.json`, so everyone on the team runs identical dependencies. Use `npm install` only when you are deliberately adding or upgrading a package.

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
variables. Do not commit real credentials. The login endpoint currently returns
only `{"status":"success"}`; it does not issue a token or session.

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
curl -X POST http://localhost:3000/register \
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
