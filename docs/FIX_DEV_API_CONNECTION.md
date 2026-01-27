# Fix Development API Connection Issues

## Problem
In development build, the database/API is not responding and you can't fetch data.

## Quick Diagnosis

### 1. Check if Server is Running
```bash
# Navigate to API directory
cd inventory-api

# Check if server is running
npm start
# or
node server.js
```

You should see: `Server running on port 3000`

### 2. Verify Server is Accessible
Open a browser and go to:
```
http://localhost:3000/assets
```

If this works, the server is running. If not, start the server.

### 3. Check What API URL is Being Used
In your app console, look for:
```
🌐 API_BASE_URL: http://... (from ...)
```

This shows what URL the app is trying to use.

## Solutions

### Solution 1: Start the Server (If Not Running)

```bash
# Navigate to API directory
cd inventory-api

# Install dependencies (if needed)
npm install

# Start the server
npm start
# or
node server.js
```

### Solution 2: Set API URL Manually for Development

**Option A: Environment Variable (Recommended)**
```bash
# Windows (CMD)
set EXPO_PUBLIC_API_URL=http://localhost:3000
npx expo start --clear

# Windows (PowerShell)
$env:EXPO_PUBLIC_API_URL="http://localhost:3000"
npx expo start --clear

# Mac/Linux
export EXPO_PUBLIC_API_URL=http://localhost:3000
npx expo start --clear
```

**Option B: Use Your Computer's IP Address**
If testing on a physical device, use your computer's IP:

```bash
# Find your IP address
# Windows: ipconfig
# Mac/Linux: ifconfig | grep "inet "

# Then set:
export EXPO_PUBLIC_API_URL=http://YOUR_IP:3000
npx expo start --clear
```

**Option C: Create `.env` file**
Create a `.env` file in the project root:
```
EXPO_PUBLIC_API_URL=http://localhost:3000
```

Then restart Expo:
```bash
npx expo start --clear
```

### Solution 3: For Web Development

If you're testing on web, `localhost:3000` should work. Make sure:
1. Server is running on port 3000
2. No firewall blocking port 3000
3. Browser can access `http://localhost:3000/assets`

### Solution 4: For Physical Device Development

If testing on a physical device (not emulator):
1. Find your computer's IP address
2. Make sure device and computer are on same network
3. Set `EXPO_PUBLIC_API_URL` to your computer's IP
4. Make sure firewall allows connections on port 3000

## Common Issues

### Issue: "Network request failed"
- **Cause**: Server not running or not accessible
- **Fix**: Start the server with `npm start` in `inventory-api/`

### Issue: "Connection refused"
- **Cause**: Server not running on port 3000
- **Fix**: Start the server

### Issue: "CORS error" (Web only)
- **Cause**: Server not allowing requests from web origin
- **Fix**: Check CORS settings in `inventory-api/server.js`

### Issue: Wrong IP address
- **Cause**: App trying to connect to wrong IP
- **Fix**: Set `EXPO_PUBLIC_API_URL` explicitly

## Testing the Connection

### From Your Computer:
```bash
# Test if server responds
curl http://localhost:3000/assets

# Should return JSON data
```

### From Your Device:
1. Open Safari/Chrome on your device
2. Navigate to: `http://YOUR_COMPUTER_IP:3000/assets`
3. Should see JSON data (or download a file)

## Quick Command Reference

```bash
# Start server
cd inventory-api && npm start

# Set API URL and restart Expo
export EXPO_PUBLIC_API_URL=http://localhost:3000
npx expo start --clear

# Check your IP (Mac/Linux)
ifconfig | grep "inet "

# Check your IP (Windows)
ipconfig

# Test server from computer
curl http://localhost:3000/assets
```

## Still Not Working?

1. **Check the console log** - Look for `🌐 API_BASE_URL: ...` to see what URL is being used
2. **Check server logs** - See if requests are reaching the server
3. **Test from browser** - Verify the endpoint works manually
4. **Check firewall** - Make sure port 3000 is not blocked

