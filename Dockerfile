FROM node:22-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY packages/contracts/package.json ./packages/contracts/
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund --prefer-offline --maxsockets=4 --fetch-retries=2
COPY backend ./backend
COPY frontend ./frontend
COPY packages/contracts ./packages/contracts
COPY scripts/web.mjs ./scripts/
ENV API_INTERNAL_URL=http://api:4000
RUN npm run db:generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production API_INTERNAL_URL=http://api:4000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/backend/package.json /app/backend/prisma.config.ts ./backend/
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/package.json /app/frontend/next.config.ts ./frontend/
COPY --from=build --chown=node:node /app/frontend/.next ./frontend/.next
USER node
CMD ["node", "backend/dist/main.js"]
