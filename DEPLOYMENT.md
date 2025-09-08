# Deployment Guide

## Prerequisites

1. Node.js (v16+ recommended)
2. npm or yarn
3. PostgreSQL (for production)
4. PM2 (for process management)
5. Nginx (as reverse proxy, optional but recommended)
6. SSL certificate (Let's Encrypt recommended)

## Server Setup

1. **Update system packages**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

2. **Install Node.js and npm**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

3. **Install PostgreSQL**
   ```bash
   sudo apt install postgresql postgresql-contrib
   sudo -u postgres createuser --interactive
   sudo -u postgres createdb assetmanagement
   ```

4. **Install PM2**
   ```bash
   sudo npm install -g pm2
   ```

## Deployment Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/AssetManagementApp.git
   cd AssetManagementApp
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd inventory-api
   npm install
   cd ..
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.production
   # Edit .env.production with your production values
   nano .env.production
   ```

4. **Build the application**
   ```bash
   npm run build
   ```

5. **Set up PM2**
   ```bash
   # Start the API server
   cd inventory-api
   pm2 start npm --name "asset-management-api" -- start
   
   # Start the frontend server (if needed)
   cd ..
   pm2 start npm --name "asset-management-web" -- start
   
   # Save PM2 process list
   pm2 save
   pm2 startup
   ```

6. **Set up Nginx (optional but recommended)**
   ```bash
   sudo apt install nginx
   sudo cp nginx.conf /etc/nginx/sites-available/asset-management
   sudo ln -s /etc/nginx/sites-available/asset-management /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

## Database Migrations

```bash
cd inventory-api
npx prisma migrate deploy
```

## Environment Variables

Create a `.env` file in the project root with the following variables:

```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/assetmanagement
JWT_SECRET=your-jwt-secret
API_URL=https://your-api-domain.com
CORS_ORIGIN=https://your-frontend-domain.com
```

## Updating the Application

1. Pull the latest changes
   ```bash
   git pull origin main
   ```

2. Install new dependencies
   ```bash
   npm install
   cd inventory-api
   npm install
   cd ..
   ```

3. Rebuild and restart
   ```bash
   npm run build
   pm2 restart all
   ```

## Monitoring

Check logs:
```bash
pm2 logs
```

Monitor processes:
```bash
pm2 monit
```

## Backup

Set up regular database backups using `pg_dump` in a cron job.
