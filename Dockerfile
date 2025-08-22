FROM node:18

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制项目文件
COPY . .

# 暴露端口
EXPOSE 8787

# 启动开发服务器
CMD ["npm", "run", "dev", "--", "--port=8787", "--ip=0.0.0.0"]