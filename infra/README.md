# Infra runbook

One Ubuntu VM runs the MCP server (and SpacetimeDB only if Maincloud fails), with Caddy giving automatic HTTPS.

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
infra/deploy.sh ubuntu@<vm-ip>
```

Restarting the service pulls `main`, runs `npm ci` and the build, then starts. The script waits for `/health`.

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
