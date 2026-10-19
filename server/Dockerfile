FROM node:24-alpine
ENV NODE_ENV=production DATA_DIR=/data BACKUP_DIR=/backups PORT=3000
WORKDIR /app
COPY package.json ./
COPY src/ ./src/
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
EXPOSE 3000
CMD ["node", "src/server.mjs"]
