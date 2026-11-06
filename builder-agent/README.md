# Docker Fix Builder Agent

Tiny HTTP service that accepts a rebuild spec from the Docker Images Downloader
web app, runs `docker build` + `docker save` on your server, and streams the
resulting fixed image tarball back.

- Runs in a container. Uses your host's Docker daemon via the mounted socket.
- Authenticates every request with HMAC-SHA256 of the raw body against a
  shared secret. No passwords, no SSH, no inbound access to your host beyond
  one HTTPS port.

## Requirements

- CentOS Stream 9 (or any Linux) with **Docker Engine** installed.
- Port `8443` reachable from the internet **OR** a Cloudflare Tunnel /
  Tailscale Funnel that fronts it. HTTPS is required — the web app will not
  talk to plain `http://` in production.

---

## Step 1 — Install Docker on CentOS Stream 9

Run these as root (or with `sudo`):

```bash
dnf -y install dnf-plugins-core
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin
systemctl enable --now docker
docker --version   # sanity check
```

## Step 2 — Generate a shared secret

Run this **on the server**. Copy the printed hex string — you will paste it
into the Lovable app in Step 5.

```bash
openssl rand -hex 32
```

Keep it in your clipboard for now.

## Step 3 — Get the agent files onto the server

Copy the three files from this folder to `/opt/docker-fix-agent/`:

- `server.mjs`
- `Dockerfile`
- `README.md` (optional)

Quickest: paste them with `cat > /opt/docker-fix-agent/server.mjs <<'EOF' ... EOF`
or `scp` from your workstation.

```bash
mkdir -p /opt/docker-fix-agent
cd /opt/docker-fix-agent
# ...place server.mjs and Dockerfile here...
ls
# Dockerfile  server.mjs
```

## Step 4 — Build & run the agent

```bash
cd /opt/docker-fix-agent
docker build -t docker-fix-agent:latest .

# Replace <PASTE_SECRET_HERE> with the value from Step 2
docker run -d \
  --name docker-fix-agent \
  --restart=always \
  -p 8443:8443 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e SHARED_SECRET='<PASTE_SECRET_HERE>' \
  docker-fix-agent:latest

# Verify
curl -sk http://127.0.0.1:8443/healthz
# → {"ok":true}
docker logs -f docker-fix-agent   # Ctrl-C to detach
```

Open the firewall port (if applicable):

```bash
firewall-cmd --permanent --add-port=8443/tcp
firewall-cmd --reload
```

## Step 5 — Expose it over HTTPS

Pick **one**:

### 5a. Cloudflare Tunnel (recommended, zero config, free)

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm \
  -o /tmp/cloudflared.rpm
dnf -y install /tmp/cloudflared.rpm

# Quick tunnel (ephemeral URL, prints https://<random>.trycloudflare.com)
cloudflared tunnel --url http://localhost:8443
```

For a permanent URL, run `cloudflared tunnel login`, `create`, `route dns`, and
`service install` — see Cloudflare's docs.

### 5b. Your own domain + Let's Encrypt

Point `builder.yourdomain.com` at your server, then use `caddy` (easiest) or
`nginx + certbot` to reverse-proxy `https://builder.yourdomain.com` →
`http://127.0.0.1:8443`.

## Step 6 — Give the app the URL and the same secret

In the Lovable app chat, tell the agent:

1. **URL**: paste the HTTPS URL from Step 5 (e.g.
   `https://foo-bar.trycloudflare.com`). The agent will save it as the
   `DOCKER_BUILDER_URL` secret.
2. **Secret**: the agent will open a secure form for the `DOCKER_BUILDER_SECRET`
   — paste the same hex string from Step 2. The two sides must match exactly.

You're done. From the app, open **Scan & Fix**, scan an image, and click
**Rebuild fixed image**.

---

## Operational notes

- Each build runs as root inside your Docker daemon. Only expose this endpoint
  to your own app; do not share the shared secret.
- The agent removes built images after streaming the tar. Old temp dirs live
  in the container's `/tmp` until it restarts.
- `docker save` output for large images can be hundreds of MB. Make sure the
  server has enough free disk and outbound bandwidth.
- To update: `docker pull` your rebuilt image or re-run `docker build`, then
  `docker rm -f docker-fix-agent && docker run …` again.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `401 invalid signature` from the app | `SHARED_SECRET` on server ≠ `DOCKER_BUILDER_SECRET` in app. Regenerate one side and re-paste. |
| `permission denied … /var/run/docker.sock` | Docker daemon not running, or SELinux blocking the mount. `systemctl start docker`; if SELinux complains, add `:z` to the mount (`-v /var/run/docker.sock:/var/run/docker.sock:z`). |
| Build fails with `pkg has no installation candidate` | Base image uses a locked-down/EOL repo. The agent falls back to a full `apt/apk/dnf upgrade` in that case. |
| Cloudflared quick tunnel URL changes every restart | Use a named tunnel (Step 5a's docs link) or your own domain (5b). |
