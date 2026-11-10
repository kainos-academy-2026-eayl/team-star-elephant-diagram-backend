# 1. Base image
FROM node:22-alpine

# 2. Working directory
WORKDIR /app

# 3. TODO: Copy package files (+ prisma folder) and install dependencies
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
RUN --mount=type=secret,id=company_ca,required=true \
    NODE_EXTRA_CA_CERTS=/run/secrets/company_ca npm ci
# 4. TODO: Copy the rest of the app code
COPY . . 
RUN --mount=type=secret,id=company_ca,required=true \
    NODE_EXTRA_CA_CERTS=/run/secrets/company_ca npm run build
# 5. TODO: Build TypeScript -> dist/

# 6. TODO: Expose the port
ENV PORT=3001
EXPOSE 3001

# 7. TODO: Start command
CMD ["npm", "run", "start"]