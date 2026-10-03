# Infra runbook

One Ubuntu VM on **Google Cloud (Compute Engine)** runs the MCP server (and SpacetimeDB only if Maincloud fails), with Caddy giving automatic HTTPS.

## Create the VM (Google Cloud console)

1. Pick a project with billing on (apply student credits under Billing → Credits).
2. Compute Engine → VM instances → Create instance: name `sprout`, region `us-east4` or `us-central1`, machine type `e2-small`, boot disk Ubuntu 24.04 LTS (20 GB), and tick **Allow HTTP traffic** and **Allow HTTPS traffic**.
3. Copy the External IP. It changes on stop/start; pin it in VPC network → IP addresses → promote to Static.
4. SSH: the **SSH** button on the VM row (browser terminal), or `gcloud compute ssh sprout --zone=<zone>`, or add your public key under Compute Engine → Metadata → SSH Keys.

Both Google's firewall (the HTTP/HTTPS checkboxes) and the VM's `ufw` must allow 80 and 443, or Caddy can't get its certificate.

| Thing | Where |
|---|---|
| App checkout | `/opt/sprout` |
| MCP service | `sprout-mcp` (systemd), port 8080, behind Caddy |
| MCP env | `/etc/sprout/mcp.env` (`PORT`, `SPROUT_STDB_URI`, `SPROUT_DB`) |
| Caddy config | `/etc/caddy/Caddyfile` |
| SpacetimeDB (optional) | `sprout-stdb` (systemd), data in `/var/lib/spacetimedb`, at `wss://stdb.<host>` |
| Firewall | ufw: 22, 80, 443 only |

The repo must be public (or add a deploy key) so the VM can `git clone`/`git pull`.

## First-time setup

SSH in, then:

```bash
curl -fsSL https://raw.githubusercontent.com/trishabthakkar/mhacks/main/infra/setup-vm.sh -o setup-vm.sh
sudo REPO_URL=https://github.com/trishabthakkar/mhacks.git bash setup-vm.sh
# only if Maincloud login doesn't work:
# sudo WITH_STDB=1 REPO_URL=... bash setup-vm.sh
```

It prints the public hostname (`<ip-with-dashes>.sslip.io` until we have a domain). Edit `/etc/sprout/mcp.env` with the real database URI/name, then `sudo systemctl restart sprout-mcp`. Safe to re-run.

## Deploy (from your laptop)

```bash
infra/deploy.sh <user>@<vm-ip>                 # plain SSH
GCE_INSTANCE=sprout GCE_ZONE=<zone> infra/deploy.sh gce   # via gcloud compute ssh
```

No SSH from your laptop? In the browser terminal run `sudo systemctl restart sprout-mcp`.

Restarting the service pulls `main`, runs `npm ci` and the build, then starts. The script waits for `/health`.

## Garden (the 3D page)

The garden is a static site served by Caddy at `https://<host>/garden/` (files in `/var/www/garden`). **Not yet run on the VM**: the scripts are written and syntax-checked only.

```bash
# once: re-run setup so Caddy gets the /garden route (safe to re-run)
sudo REPO_URL=https://github.com/trishabthakkar/mhacks.git bash setup-vm.sh
# every time the garden changes (from your laptop):
infra/deploy-garden.sh <user>@<vm-ip>            # or: GCE_INSTANCE=sprout GCE_ZONE=<zone> infra/deploy-garden.sh gce
```

It builds with `VITE_STDB_HOST`/`VITE_STDB_DB` (defaults: Maincloud, `sprout-mhacks`) and the page still accepts `?db=` and `?host=` overrides. Then use `https://<host>/garden/?db=sprout-demo&present=1` on the projector.

## Logs / restart / status

```bash
sudo journalctl -u sprout-mcp -f          # follow logs
sudo systemctl restart sprout-mcp
sudo systemctl status sprout-mcp
sudo journalctl -u caddy -n 50            # HTTPS problems
sudo journalctl -u sprout-stdb -n 50      # if running SpacetimeDB here
```

## Rollback

```bash
sudo -u sprout git -C /opt/sprout log --oneline | head      # find the good commit
sudo -u sprout git -C /opt/sprout reset --hard <sha>
```

Then temporarily stop the pull: `sudo systemctl edit sprout-mcp`, add an empty `ExecStartPre=` line, restart. Remove the override after fixing `main`.

## Domain

When we have a `.tech` domain, add an `A` record `mcp` → VM IP, then replace the first line of the Caddyfile with `mcp.<domain> {` and `sudo systemctl reload caddy`. Update the team code with the new URL.

## Troubleshooting

- `/health` fails over HTTPS but works on `127.0.0.1:8080`: Caddy hasn't got a cert yet. Check ports 80/443 are open in the cloud provider's firewall too, then `journalctl -u caddy`.
- Service restarts in a loop: `journalctl -u sprout-mcp -n 50`, usually a bad env value or a failing build on `main`.
