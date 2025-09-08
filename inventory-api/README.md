# Inventory Management API

This is the backend API for the Asset Management Application.

## Prerequisites

- Node.js 18 or higher
- Docker and Docker Compose
- npm or yarn

## Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Update the `.env` file with your local configuration.

3. Start the PostgreSQL database:
   ```bash
   docker-compose up -d
   ```

4. Install dependencies:
   ```bash
   npm install
   ```

5. Run database migrations:
   ```bash
   npx prisma migrate dev
   ```

## Development

- Start the development server:
  ```bash
  npm run dev
  ```

- Run tests:
  ```bash
  npm test
  ```

- Access Prisma Studio (database GUI):
  ```bash
  npx prisma studio
  ```

## Environment Variables

- `PORT` - Port to run the server on (default: 3000)
- `NODE_ENV` - Environment (development, production, test)
- `DATABASE_URL` - PostgreSQL connection string
- `QR_CODE_PATH` - Path to store QR code images

## API Documentation

Once the server is running, you can access:

- API: http://localhost:3000
- pgAdmin: http://localhost:5050
  - Email: admin@example.com
  - Password: admin

## Database

- Host: localhost
- Port: 5432
- Database: asset_management
- Username: postgres
- Password: postgres

## Testing

Run the test suite:

```bash
npm test
```

## Linting and Formatting

- Lint: `npm run lint`
- Format: `npm run format`
