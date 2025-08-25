# 使用 Ubuntu 22.04 作为基础镜像，它包含 GLIBC 2.35+
FROM ubuntu:22.04

# 安装必要的工具
RUN apt-get update && apt-get install -y \
    curl \
    git \
    bash \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g wrangler \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 创建工作目录
WORKDIR /workspace

# 复制 package 文件
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制项目文件
COPY . .

# 暴露端口
EXPOSE 8787 9229

# 设置默认命令
CMD ["npm", "run", "dev"]