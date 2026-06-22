# Token Plan 用量查询网页
# 同时提供静态页面与本地 API 代理服务

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# 本项目无第三方依赖，无需 npm install
# 如需后续扩展依赖可取消下面注释
# RUN npm install --production

COPY . .

EXPOSE 3456

CMD ["node", "server.mjs"]
