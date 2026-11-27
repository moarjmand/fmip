#!/usr/bin/env bash
# Read-only security snapshot of the production server and site (T-1684, D-328), for the security agent.
#
#     bash .claude/skills/fmip-security/server-hardening.sh
#
# Lists listening ports, the SSH daemon's effective settings, the firewall, automatic updates, the
# site's response headers and the origin lock. Never prints a secret, never changes anything.
#
# Fixture mode (T-1895): FMIP_FIXTURE=<dir> replays a saved run and opens no connection: it prints
# <dir>/server-hardening.txt and exits with the code in <dir>/server-hardening.exit (0 when there is
# none). Make one with `bash server-hardening.sh > <dir>/server-hardening.txt; echo $? > <dir>/server-hardening.exit`.

set -uo pipefail
if [ -n "${FMIP_FIXTURE:-}" ]; then
  fx="$FMIP_FIXTURE/server-hardening"
  [ -f "$fx.txt" ] || { echo "HARDENING-ERROR: FMIP_FIXTURE is set and $fx.txt is missing (no connection was opened)"; exit 2; }
  status=0; [ -f "$fx.exit" ] && status="$(tr -d ' \t\r\n' < "$fx.exit")"
  case "$status" in ''|*[!0-9]*) echo "HARDENING-ERROR: $fx.exit holds no exit code"; exit 2 ;; esac
  cat "$fx.txt"
  exit "$status"
fi
echo "== site headers (https://traveltohormuz.ir/en)"
ssh -o ConnectTimeout=20 fmip-prod 'h="$(curl -sI -m 20 https://traveltohormuz.ir/en)"; printf "%s\n" "$h" | cut -d: -f1 | tr "A-Z" "a-z" | sort -u | tr "\n" " "; echo
for want in strict-transport-security content-security-policy x-frame-options x-content-type-options referrer-policy permissions-policy; do
  printf "%s\n" "$h" | grep -qi "^$want:" && echo "present: $want" || echo "MISSING: $want"; done
printf "%s\n" "$h" | grep -iE "^(x-powered-by|server):" | cut -c1-120'
ssh -o ConnectTimeout=20 fmip-prod 'bash -s' <<'REMOTE'
echo "== listening TCP ports (address:port process)"
ss -tlnH 2>/dev/null | awk '{print $4}' | sort -u
echo "== sshd effective settings"
sudo -n sshd -T 2>/dev/null | grep -iE '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|maxauthtries|x11forwarding|allowusers) ' \
  || grep -hiE '^\s*(PermitRootLogin|PasswordAuthentication|KbdInteractiveAuthentication|PubkeyAuthentication|MaxAuthTries|X11Forwarding|AllowUsers)\b' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null \
  || echo "not readable without sudo"
echo "== firewall"
(sudo -n ufw status 2>/dev/null | head -20) || echo "ufw status needs sudo"
echo "== automatic security updates"
systemctl is-enabled unattended-upgrades 2>/dev/null || echo "unattended-upgrades not installed"
ls -la /var/lib/apt/periodic/ 2>/dev/null | tail -3
echo "== packages waiting for upgrade (security)"
apt list --upgradable 2>/dev/null | grep -ci security || true
echo "== reboot required (since) and up since"
[ -f /var/run/reboot-required ] && { cat /var/run/reboot-required; stat -c 'pending since %y' /var/run/reboot-required; cat /var/run/reboot-required.pkgs 2>/dev/null | head -5; } || echo "no"
uptime -s
echo "== origin lock: direct request to the server's own address (should be refused)"
ip="$(hostname -I | awk '{print $1}')"
curl -s -o /dev/null -m 8 -w '%{http_code}\n' -k --resolve "traveltohormuz.ir:443:$ip" https://traveltohormuz.ir/health || echo "refused or no answer (expected)"
echo "== failed SSH logins, last 24 h"
(sudo -n journalctl -u ssh -u sshd --since "24 hours ago" 2>/dev/null | grep -c "Failed password\|Invalid user") || echo "journal needs sudo"
echo "== end"
REMOTE
