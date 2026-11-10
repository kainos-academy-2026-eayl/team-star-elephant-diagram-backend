# syntax=docker/dockerfile:1
FROM node:22-bookworm AS build

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
COPY --from=certificates ["KAINOS-ZSCALER G2_2027.pem", "/usr/local/share/ca-certificates/company-ca.crt"]
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/company-ca.crt

RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

FROM build AS migrations

USER node

CMD ["npm", "run", "db:deploy"]

FROM build AS production-dependencies

RUN npm prune --omit=dev --omit=optional --ignore-scripts

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

COPY --from=certificates ["KAINOS-ZSCALER G2_2027.pem", "/usr/local/share/ca-certificates/company-ca.crt"]
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/company-ca.crt
ENV NODE_ENV=production
ENV PORT=3001

COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=production-dependencies /app/node_modules ./node_modules

USER node

EXPOSE 3001

CMD ["node", "dist/index.js"]