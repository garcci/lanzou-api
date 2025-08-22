const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// 模拟 Cloudflare KV 命名空间
class MockKVNamespace {
  constructor() {
    this.store = new Map();
  }

  async get(key, options) {
    const value = this.store.get(key);
    if (!value) return null;
    
    if (options && options.type === 'json') {
      try {
        return JSON.parse(value);
      } catch (e) {
        return null;
      }
    }
    
    return value;
  }

  async put(key, value, options) {
    let serializedValue = value;
    if (typeof value === 'object' && value !== null) {
      serializedValue = JSON.stringify(value);
    }
    this.store.set(key, serializedValue);
    return true;
  }

  async delete(key) {
    return this.store.delete(key);
  }

  async list() {
    const keys = Array.from(this.store.keys()).map(key => ({ name: key }));
    return { keys };
  }
}

// 模拟 Cloudflare 环境
const env = {
  DOWNLOAD_CACHE: new MockKVNamespace()
};

// 模拟 Cloudflare context
const ctx = {
  waitUntil: (promise) => {
    // 在本地环境中直接执行，不等待
    promise.catch(err => console.error('Background task error:', err));
  }
};

// 导入 worker.js 中的处理逻辑
const workerModule = require('./worker.js');

app.get('/', async (req, res) => {
  const request = {
    url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
  };
  
  try {
    const response = await workerModule.default.fetch(request, env, ctx);
    const buffer = await response.arrayBuffer();
    res.set(Object.fromEntries(response.headers));
    res.status(response.status).send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
});

app.get('/health', async (req, res) => {
  const request = {
    url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
  };
  
  try {
    const response = await workerModule.default.fetch(request, env, ctx);
    const buffer = await response.arrayBuffer();
    res.set(Object.fromEntries(response.headers));
    res.status(response.status).send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
});

app.get('/refresh', async (req, res) => {
  const request = {
    url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
  };
  
  try {
    const response = await workerModule.default.fetch(request, env, ctx);
    const buffer = await response.arrayBuffer();
    res.set(Object.fromEntries(response.headers));
    res.status(response.status).send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
});

app.get('/:id/:pwd?', async (req, res) => {
  const { id, pwd } = req.params;
  const request = {
    url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
  };
  
  try {
    const response = await workerModule.default.fetch(request, env, ctx);
    if (response.status === 302) {
      // 对于重定向，我们返回 JSON 格式的信息而不是实际重定向
      const location = response.headers.get('location');
      res.json({
        code: 200,
        url: location,
        message: 'Redirect URL obtained successfully'
      });
    } else {
      const buffer = await response.arrayBuffer();
      res.set(Object.fromEntries(response.headers));
      res.status(response.status).send(Buffer.from(buffer));
    }
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
});

app.listen(port, () => {
  console.log(`蓝奏云直链解析服务本地测试服务器运行在端口 ${port}`);
  console.log(`访问 http://localhost:${port} 查看服务状态`);
  console.log(`使用 http://localhost:${port}/:id 或 http://localhost:${port}/:id/:pwd 解析链接`);
});