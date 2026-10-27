# DEPLOY — VPS runbook (mkt-hk-test / Ubuntu 22.04)

> Box đích: KVM HK2, 4GB/2core, **đang chạy production khác** (trippool + mkt-tools).
> Nguyên tắc: worker là container có `mem_limit` — không được phá resource những service cũ.
> Monitor tuần đầu: `docker stats` + `htop`, cảnh báo nếu worker chạm >1.5GB kéo dài → tách VPS riêng.

## 1. Cài đặt (1 lần)

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# GPM-Login (antidetect, bản Linux — API localhost:9495)
# → tải bản Linux server tại gpmlogin.com, cài theo hướng dẫn của họ;
#   service phải listen http://127.0.0.1:9495 (KHÔNG expose public)

# (tùy chọn) VNC cho checkpoint can thiệp tay
sudo apt-get install -y xvfb x11vnc
x11vnc -display :99 -rfbport 5900 -passwd <mật-khẩu-riêng> -localhost -forever &
# chỉ truy cập qua SSH tunnel: ssh -L 5900:localhost:5900 root@<vps-ip>
```

## 2. Deploy worker

```bash
git clone https://github.com/anhvult911/affiliate-ERP.git && cd affiliate-ERP
cp .env.example .env.production     # điền đủ giá trị (same như checklist của HR)
npm i -g pnpm && pnpm install --frozen-lockfile

docker compose -f docker-compose.prod.yml config          # validate trước
docker compose -f docker-compose.prod.yml up -d --build
curl -s http://127.0.0.1:8080/health                     # → {"ok":true,"version":"..."}
docker compose -f docker-compose.prod.yml logs -f worker
```

Health endpoint bind `127.0.0.1` trong container — không publicly reachable.

## 3. Test trên VPS theo thứ tự

```bash
# 1. Smoke integrations (cùng .env.production)
docker compose -f docker-compose.prod.yml run --rm --entrypoint node worker dist/scripts/smoke.js
# hoặc chạy trực tiếp trên host: pnpm smoke

# 2. Fixture executor (không browser thật) — chứng minh queue chạy
docker compose -f docker-compose.prod.yml run --rm --entrypoint pnpm worker worker:fixture

# 3. Một profile FB thật, MÔI TRƯỜNG AN TOÀN:
#    - tạo profile trong GPM (qua VNC), login FB tay 1 lần
#    - .env.production: ANTIDETECT_PROVIDER=gpm, DRY_RUN=true, EXECUTOR=facebook
docker compose -f docker-compose.prod.yml up -d worker
#    theo dõi: worker chỉ claim + soạn, KHÔNG đăng gì khi DRY_RUN=true

# 4. Khi xác nhận draft ổn (xem qua Telegram approval): DRY_RUN=false, restart worker
```

## 4. Vận hành

- **Checkpoint FB**: worker báo qua Telegram → vào VNC tay xử lý → xong việc profile tự tiếp tục (trust system tự cooldown).
- **Logs**: `docker compose -f docker-compose.prod.yml logs --tail 100 worker`
- **Restart sau đổi env**: `docker compose -f docker-compose.prod.yml restart worker`
- **Backup profiles volume** (mất = login lại mọi account, dấy suspicion): `docker run --rm -v affiliate-worker_worker-profiles:/p -v $PWD:/backup alpine tar czf /backup/profiles-$(date +%F).tar.gz -C /p .`
- **Nâng cấp**: giữ 1 profile → RAM ổn định; muốn 2–3 profile → VPS riêng 4GB (Hetzner ~95k/tháng).

## 5. Frontend (Next.js)
Deploy lên Vercel: import repo → env giống `.env.production` (trừ SERVICE_ROLE chỉ để server env var của Vercel) → `NEXT_PUBLIC_SITE_URL` = URL Vercel → webhook Telegram trỏ `/api/telegram/webhook`.
