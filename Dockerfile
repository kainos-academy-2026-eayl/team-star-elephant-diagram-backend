FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates openssl libstdc++

RUN --mount=type=secret,id=corporate_ca \
    if [ -f /run/secrets/corporate_ca ]; then \
        cat /run/secrets/corporate_ca >> /etc/ssl/certs/ca-certificates.crt; \
    fi

ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start"]
