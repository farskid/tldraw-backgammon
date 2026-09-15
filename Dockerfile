# Single-process production image: the Node server serves the built client,
# the tldraw sync WebSocket, and the HTTP move API on one port ($PORT, default 5858).
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY . .

# Optional tldraw license key, baked into the client bundle at build time.
ARG VITE_TLDRAW_LICENSE_KEY
ENV VITE_TLDRAW_LICENSE_KEY=$VITE_TLDRAW_LICENSE_KEY
RUN npm run build

ENV NODE_ENV=production
EXPOSE 5858
CMD ["npm", "start", "-w", "server"]
