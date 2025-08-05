// scripts/seedQR.js
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../inventory-api/generated/prisma');
const QRCode = require('qrcode');
const prisma = new PrismaClient();
const config = require('./config');
const logger = require('./logger');

// Helper to generate 8-character alphanumeric IDs
function generateId(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < length; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

async function generateUniqueId(usedIds, length = 8) {
  // Characters allowed in the generated ID
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  // Generate a random string of the specified length
  for (let i = 0; i < length; i++) id += chars[Math.floor(Math.random() * chars.length)];
  // Ensure the ID is unique by checking against usedIds
  if (usedIds.has(id)) return generateUniqueId(usedIds, length);
  return id;
}

// Main function to generate QR codes and insert asset records
async function main() {
  // Track used IDs to ensure uniqueness
  const usedIds = new Set();
  // Determine the folder where QR codes will be saved
  const qrFolder = path.join(__dirname, config.QR_FOLDER);
  // Create the folder if it doesn't exist
  if (!fs.existsSync(qrFolder)) fs.mkdirSync(qrFolder);

  try {
    // Loop to generate the desired number of assets and QR codes
    for (let i = 0; i < config.QR_ASSET_COUNT; i++) {
      // Generate a unique asset ID
      let id = await generateUniqueId(usedIds);
      usedIds.add(id);
      // Build the URL for the asset's check-in page
      const baseUrl = config.PROD_API_URL.startsWith('http') ? config.PROD_API_URL : `http://${config.PROD_API_URL}`;
      const url = `${baseUrl}/check-in/${id}`;
      // Determine the file path for the QR image
      const filePath = path.join(qrFolder, `${id}.png`);
      // Generate and save the QR code image
      await QRCode.toFile(filePath, url);
      try {
        // Insert the asset record into the database
        await prisma.assets.create({
          data: {
            id,
            serial_number: null,
            model: null,
            description: 'QR reserved asset',
            location: null,
            assigned_to_id: null,
            type_id: null,
            status: 'Available',
          },
        });
        // Log successful insertion and QR generation
        logger.info(`Inserted asset ${id} and QR saved to ${config.QR_FOLDER}/${id}.png`);
      } catch (err) {
        // Log any errors during database insertion
        logger.error(`Failed to insert ${id}: ${err.stack || err}`);
      }
    }
  } catch (err) {
    // Log any errors during the overall QR generation process
    logger.error(`QR generation failed: ${err.stack || err}`);
  } finally {
    // Ensure the database connection is closed
    await prisma.$disconnect();
    logger.info('Prisma disconnected.');
  }
}

main();
