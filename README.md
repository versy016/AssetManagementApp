# Asset Management App

A comprehensive asset management solution built with React Native, Expo, and Node.js. This application helps organizations track, manage, and maintain their physical assets efficiently.

## Features

- 📱 Cross-platform mobile app (iOS & Android)
- 🔍 Advanced search and filtering
- 📊 Asset tracking and management
- 🔐 User authentication and authorization
- 📱 Offline support
- 📱 Barcode/QR code scanning
- 📊 Reporting and analytics

## Tech Stack

- **Frontend**: React Native, Expo, React Navigation
- **Backend**: Node.js, Express, Prisma
- **Database**: PostgreSQL
- **Authentication**: Firebase Authentication
- **Hosting**: AWS EC2
- **CI/CD**: GitHub Actions

## Prerequisites

- Node.js (v16+)
- npm or yarn
- Expo CLI
- PostgreSQL
- Firebase account (for authentication)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/AssetManagementApp.git
cd AssetManagementApp
```

### 2. Install dependencies

```bash
# Install root dependencies
npm install

# Install API dependencies
cd inventory-api
npm install
cd ..
```

### 3. Set up environment variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Update the `.env` file with your configuration.

### 4. Start the development server

```bash
# Start the Expo development server
npm start

# In a separate terminal, start the API server
cd inventory-api
npm run dev
```

## Project Structure

```
.
├── app/                    # Expo app directory
├── assets/                 # Static assets (images, fonts, etc.)
├── components/             # Reusable React components
├── constants/              # App constants
├── hooks/                  # Custom React hooks
├── inventory-api/          # Backend API server
│   ├── prisma/             # Database schema and migrations
│   ├── routes/             # API routes
│   └── server.js           # Express server entry point
├── scripts/                # Utility scripts
├── utils/                  # Utility functions
├── .env.example            # Example environment variables
├── app.json               # Expo configuration
└── package.json           # Project dependencies
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, please open an issue in the repository or contact the maintainers.

---

Built with ❤️ by Your Name
