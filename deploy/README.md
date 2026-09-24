# 公网部署（生产）

2C4G 阿里云 · 仅暴露 80/443。

## 服务器一键初始化

```bash
bash deploy/setup-server.sh
```

## 上传与启动

本地：

```bash
# 打包源码（排除依赖与密钥）
tar --exclude=node_modules --exclude=.venv --exclude=.next --exclude=.next-dev \
    --exclude=.git --exclude=codle.pem --exclude='web/.env*' --exclude=algo/.env \
    -czf /tmp/copaddle.tgz -C .. CoPaddle

scp /tmp/copaddle.tgz root@47.97.96.242:/opt/
ssh root@47.97.96.242 'mkdir -p /opt/copaddle && tar -xzf /opt/copaddle.tgz -C /opt && ls /opt/CoPaddle'
```

服务器：

```bash
cd /opt/CoPaddle/deploy
cp env.example .env
# 编辑 .env：POSTGRES_PASSWORD / AUTH_SECRET / ALGO_SHARED_SECRET / LLM_API_KEY
bash deploy.sh
```

## 安全

- 库/algo 不对公网映射端口
- 强制改掉默认密码与演示账号 `copaddle123`
- 有域名后把 Caddyfile 换成域名块以启用 HTTPS
