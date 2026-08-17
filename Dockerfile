FROM node:20-alpine AS development
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "dev"]

FROM development AS build
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/src/emails ./emails
COPY --chown=node:node --from=build /app/images ./images
USER node
CMD ["node", "dist/main.js"]
