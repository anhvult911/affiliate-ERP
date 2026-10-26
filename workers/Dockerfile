# Execution worker image.
#
#   docker build -f workers/Dockerfile -t affiliate-worker .
#   docker run --env-file workers/.env -v affiliate-profiles:/app/workers/.profiles affiliate-worker
#
# Two decisions worth knowing:
#
# * BROWSER_CHANNEL is empty here. `chrome` means "use the machine's installed
#   Chrome", which is the better fingerprint on a desktop but does not exist in this
#   image, so the worker falls back to Playwright's Chromium.
# * Facebook sometimes asks for a human (checkpoint/captcha). That cannot be solved
#   headlessly; a container can only report it. Run the worker on a desktop with a
#   display if you need to intervene, or attach to this container through a VNC build
#   of the image.

FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production \
    BROWSER_CHANNEL="" \
    WORKER_HEALTH_PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates git curl xvfb xauth tini \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# Workspace manifests first: the dependency layer survives source edits.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY workers/package.json workers/package.json
RUN pnpm install --filter affiliate-worker... --frozen-lockfile

# Chromium for Playwright, with the OS libraries it needs.
RUN pnpm --filter affiliate-worker exec playwright install --with-deps chromium

COPY workers ./workers

WORKDIR /app/workers

# Liveness endpoint (GET /health); the compose healthcheck probes it.
EXPOSE 8080

# Headed Chromium needs a display; Xvfb provides one without a physical monitor.
# tini reaps zombie browser processes, of which there are many.
ENTRYPOINT ["/usr/bin/tini", "--", "xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x800x24"]
CMD ["pnpm", "start"]
