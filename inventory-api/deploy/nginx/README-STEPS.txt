================================================================================
GearOps — Nginx Option A (conf.d) + Let's Encrypt
================================================================================

REDEPLOY (web + API to EC2)
  GitHub: push to branch "main", OR open Actions → "Deploy Expo Web and API to EC2"
          → Run workflow (needs secrets EC2_HOST, EC2_SSH_KEY).
  Manual from repo root (PowerShell), then upload dist/ to the server web-build:
    $env:EXPO_PUBLIC_API_URL="https://api.gearops.com.au"; npx expo export --platform web
    scp -r dist/* ec2-user@YOUR_HOST:/home/ec2-user/deploy/AssetManagementApp/web-build/
  API on server after copying inventory-api/:
    cd /home/ec2-user/deploy/AssetManagementApp/inventory-api && npm install && npx prisma generate && pm2 restart all


PREREQUISITES (Option A — subdomain)
  - DNS A records → same Elastic IP:
      gearops.com.au
      www.gearops.com.au
      api.gearops.com.au
  - EC2 security group: TCP 80 + 443 open
  - Node API on 127.0.0.1:3000 (pm2)
  - Expo web static export deployed to:
      /home/ec2-user/deploy/AssetManagementApp/web-build
    (see repo .github/workflows/deploy-web.yml — build sets EXPO_PUBLIC_API_URL=https://api.gearops.com.au)

FILES IN THIS FOLDER (copy to server with scp, or paste contents)
  - nginx.main.conf              → /etc/nginx/nginx.conf
  - gearops.phase1-http-only.conf → /etc/nginx/conf.d/gearops.conf (step A–D)
  - gearops.production.conf       → /etc/nginx/conf.d/gearops.conf (step E)

================================================================================
STEP A — Backup and disable default site (avoid duplicate port 80)
================================================================================

sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak
sudo test -f /etc/nginx/conf.d/default.conf && sudo mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak

================================================================================
STEP B — Install main nginx.conf (no server{} inside http — only includes)
================================================================================

sudo nano /etc/nginx/nginx.conf
   (Replace entire file with contents of nginx.main.conf from this repo.)

OR from your laptop (adjust path/user):
  scp inventory-api/deploy/nginx/nginx.main.conf ec2-user@YOUR_SERVER:/tmp/nginx.main.conf
  ssh ec2-user@YOUR_SERVER 'sudo cp /tmp/nginx.main.conf /etc/nginx/nginx.conf'

================================================================================
STEP C — Phase 1 vhost (HTTP only — get certificates)
================================================================================

sudo mkdir -p /var/www/certbot

sudo nano /etc/nginx/conf.d/gearops.conf
   (Paste contents of gearops.phase1-http-only.conf)

sudo nginx -t && sudo systemctl reload nginx

================================================================================
STEP D — Certbot (webroot)
================================================================================

Amazon Linux 2 (yum):
  sudo yum install -y certbot

Amazon Linux 2023 (dnf):
  sudo dnf install -y certbot

Issue one cert for web + API hostnames (SAN):
  sudo certbot certonly --webroot -w /var/www/certbot \
    -d gearops.com.au -d www.gearops.com.au -d api.gearops.com.au \
    --email YOUR_EMAIL@example.com --agree-tos --non-interactive

If you already have a cert without api.*, expand it:
  sudo certbot certonly --webroot -w /var/www/certbot --expand \
    -d gearops.com.au -d www.gearops.com.au -d api.gearops.com.au

================================================================================
STEP E — Switch to production config (HTTPS + redirect HTTP→HTTPS)
================================================================================

sudo cp /etc/nginx/conf.d/gearops.conf /etc/nginx/conf.d/gearops.conf.phase1.bak
sudo nano /etc/nginx/conf.d/gearops.conf
   (Replace with contents of gearops.production.conf)

sudo nginx -t && sudo systemctl reload nginx

Test:
  https://gearops.com.au        → Expo web (index.html)
  https://api.gearops.com.au/   → JSON {"status":"ok",...}
  curl -I https://gearops.com.au/nonexistent → should serve index.html (SPA)

================================================================================
STEP F — Auto-renewal
================================================================================

sudo systemctl enable certbot-renew.timer   # if unit exists
sudo systemctl start certbot-renew.timer
sudo systemctl list-timers | grep certbot

Or add cron:
  sudo certbot renew --dry-run

================================================================================
TROUBLESHOOTING
================================================================================
  sudo nginx -t                     Always use sudo (see SSL section below)
  sudo tail -f /var/log/nginx/error.log
  curl -I http://gearops.com.au     Should redirect to https after step E
  curl -I https://gearops.com.au           Expect 200 if web-build exists
  curl -I https://api.gearops.com.au/      Expect 200 JSON from API

--------------------------------------------------------------------------------
SSL: "Permission denied" on fullchain.pem / privkey.pem
--------------------------------------------------------------------------------
Nginx workers run as user "nginx" and must read /etc/letsencrypt/... files.
Certbot often leaves keys as root:root mode 600, so workers cannot open them.

1) Test as root (avoids false errors when you ran nginx -t as ec2-user):
     sudo nginx -t

2) If it still fails, grant the nginx group read access (safe with 640 on keys):
     sudo chgrp -R nginx /etc/letsencrypt/live /etc/letsencrypt/archive
     sudo chmod -R g+rX /etc/letsencrypt/live /etc/letsencrypt/archive
     sudo find /etc/letsencrypt/archive -name "privkey*.pem" -exec chmod 640 {} \;
     sudo nginx -t && sudo systemctl reload nginx

   If your distro uses "www-data" instead of "nginx", substitute that group.

3) Optional: re-apply after each "certbot renew" by adding a deploy hook:
     echo '#!/bin/sh
     chgrp -R nginx /etc/letsencrypt/live /etc/letsencrypt/archive
     chmod -R g+rX /etc/letsencrypt/live /etc/letsencrypt/archive
     find /etc/letsencrypt/archive -name "privkey*.pem" -exec chmod 640 {} \;
     systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/nginx-perms.sh
     sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/nginx-perms.sh

4) SELinux (if getenforce = Enforcing): if errors persist after step 2:
     sudo restorecon -Rv /etc/letsencrypt

--------------------------------------------------------------------------------
Warning: "user directive ... only if master runs with super-user privileges"
--------------------------------------------------------------------------------
Harmless if you ran nginx -t without sudo. Use: sudo nginx -t

--------------------------------------------------------------------------------
Web: 403 "directory index ... forbidden" or "redirection cycle" to /index.html
--------------------------------------------------------------------------------
Usually means web-build is empty, missing index.html, or the nginx user cannot
read the file (chmod/chown). Confirm on the server:
  ls -la /home/ec2-user/deploy/AssetManagementApp/web-build/index.html
  sudo -u nginx test -r .../web-build/index.html && echo OK
Redeploy the Expo web export to web-build/ if the file is absent.

================================================================================
