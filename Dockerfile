# syntax=docker/dockerfile:1

# Build workshop stage
FROM node:22-bookworm AS build

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
# Install company CA certificate if provided as a secret. Optional.
RUN --mount=type=secret,id=company_ca,required=false \
  set -eu; \
  if [ -f /run/secrets/company_ca ]; then \
  openssl x509 -in /run/secrets/company_ca -noout; \
  install -m 0644 \
  /run/secrets/company_ca \
  /usr/local/share/ca-certificates/company-ca.crt; \
  fi; \
  update-ca-certificates

ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

# Database migrations stage
FROM build AS migrations

USER node

CMD ["sh", "-c", "npm run db:deploy && npm run db:seed"]

# Node dependencies (modules) stage
FROM build AS production-dependencies

RUN npm prune --omit=dev --omit=optional --ignore-scripts

# Runtime stage
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN --mount=type=secret,id=company_ca,required=false \
  set -eu; \
  if [ -f /run/secrets/company_ca ]; then \
  openssl x509 -in /run/secrets/company_ca -noout; \
  install -m 0644 \
  /run/secrets/company_ca \
  /usr/local/share/ca-certificates/company-ca.crt; \
  fi; \
  update-ca-certificates

ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build --chmod=755 /app/scripts/entrypoint.sh ./scripts/entrypoint.sh
COPY --from=production-dependencies /app/node_modules ./node_modules

USER node

EXPOSE 3001

CMD ["./scripts/entrypoint.sh"]