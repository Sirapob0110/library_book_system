# ภาพเดียวใช้รันได้ทั้ง 3 บริการ (กำหนดคำสั่งใน docker-compose.yml)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY openapi.yaml ./
USER node
EXPOSE 3000 3001 8000
CMD ["node", "src/index.js"]
