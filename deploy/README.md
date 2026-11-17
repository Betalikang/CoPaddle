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
- **登录页的演示账号与口令现在是显式开关**：只在 `DEMO_MODE=true` 且设置了 `DEMO_PASSWORD` 时才由服务端渲染并传给登录页；正式环境保持 `DEMO_MODE` 未设置或为 `false`，登录页不渲染演示区块，客户端 bundle 里也没有这段代码的数据。
- **不要用内置口令 `123456` 对外**：`web/scripts/demo-credentials.ts` 在有 `DEMO_PASSWORD` 时用它；没有且 `NODE_ENV=production` 时直接抛错拒绝建号（不会悄悄写一个弱口令账户）。
- **HTTPS 由 `SITE_ADDRESS` 驱动**：`deploy/env.example` 里把 `SITE_ADDRESS` 写成域名（例如 `copaddle.example.com`），Caddy 会自动申请证书并把 HTTP 301 到 HTTPS；只写 `:80` 就仍是纯 HTTP，此时必须把 `COOKIE_SECURE` 设为 `false`，否则浏览器会丢弃会话 cookie。
- 会话 cookie 的 `Secure` 取值统一在 `web/lib/auth/cookie-policy.ts`：`COOKIE_SECURE` 显式指定优先，否则按 `BASE_URL` 的协议推断，默认 `true`。签发（`web/lib/auth/session.ts`）与续期（`web/middleware.ts`）都走这一个函数，不会再出现「签发是 HTTP cookie、续期却硬写 Secure」的不一致。
- **迁移失败会中止部署**：`deploy.sh` 与 `up-all.sh` 里的 `drizzle-kit migrate` 现在失败即 `exit 1`（以前是 `|| true`，迁移挂了仍会启动新版本，表现为新代码对着旧表结构跑、报错推迟到用户点击时）。
- **归档课程是只读的**：`courses.status='archived'` 的课程会拒绝所有写操作（改设置、重新分组、改任务状态、发布互评等）并返回 409，读与导出不受影响；要恢复写入需先把课程状态改回 `active`（`PATCH /api/courses/{id}` 本身不受只读限制）。

## 回滚

1. `docker compose -f docker-compose.prod.yml down`（保留 volume）。
2. `git checkout <上一个发布点的 commit>` 后 `bash deploy.sh`。
3. 若本次发布含不可逆迁移，先按迁移文件的 `--` 注释里记录的反向语句手工回退，再启动旧版本；本仓库的迁移默认只做加列/加索引，破坏性变更需在 PR 里单独说明。

线上库的备份在发布前用 `docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql` 取一份，发布过程出问题直接 `psql < backup.sql` 回灌。
