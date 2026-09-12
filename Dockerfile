FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/service ./packages/service
COPY --chown=node:node packages/evaluator ./packages/evaluator
COPY --chown=node:node packages/signal ./packages/signal
COPY --chown=node:node packages/agent ./packages/agent
COPY --chown=node:node packages/privy-hedera-poc ./packages/privy-hedera-poc
COPY --chown=node:node scripts ./scripts

RUN npm ci --omit=dev --ignore-scripts \
      --workspace @desk/service \
      --workspace @desk/agent \
      --workspace @desk/privy-hedera-poc \
      --include-workspace-root=false \
    && npm cache clean --force

USER node

EXPOSE 8080

CMD ["npm", "run", "start:service"]
