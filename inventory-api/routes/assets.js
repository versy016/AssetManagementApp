const express = require('express');
const router = express.Router();
const { PrismaClient } = require('../generated/prisma'); // ✅ Matches your `schema.prisma`
const prisma = new PrismaClient();
const AWS = require('aws-sdk');
const multer = require('multer');
require('dotenv').config({ path: '../.env' }); // Adjust path if .env is outside routes/

// GET all assets
router.get('/', async (req, res) => {
  try {
    console.log('Fetching all assets...');
    
    // First, verify database connection
    await prisma.$connect();
    console.log('Database connection successful');
    
    // Get all assets with related data
    const assets = await prisma.assets.findMany({
      include: {
        asset_types: true,
        users: {
          select: {
            id: true,
            name: true,
            useremail: true
          }
        },
      },
    });
    
    console.log(`Successfully fetched ${assets.length} assets`);
    res.json(assets);
    
  } catch (error) {
    console.error('❌ Error in /assets route:', {
      message: error.message,
      stack: error.stack,
      error: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });
    
    // Check if headers have already been sent
    if (res.headersSent) {
      return console.error('Headers already sent, cannot send error response');
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch assets',
      message: error.message,
      // Only include stack trace in development
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
});
router.get('/asset-options', async (req, res) => {
  try {
    const assetTypes = await prisma.asset_types.findMany(); // ✅ correct model name
    const models = []; // add later
    const users = await prisma.users.findMany();
    const statuses = ['Available', 'In Use', 'Rented', 'Maintenance'];

    const placeholderAssets = await prisma.assets.findMany({
      where: {
        assigned_to_id: null,
        status: 'Available',
      },
      select: { id: true },
    });

    const assetIds = placeholderAssets.map(a => a.id);

    console.log('✅ Sending assetIds:', assetIds);

    res.json({
      assetTypes,
      models,
      users,
      statuses,
      assetIds, // ✅ this was previously missing
    });
  } catch (err) {
    console.error('🔥 Error in /asset-options:', err);
    res.status(500).json({ error: 'Failed to fetch dropdown options' });
  }
});





const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage }).fields([
  { name: 'image', maxCount: 1 },
  { name: 'document', maxCount: 1 }
])
const multerInstance = multer({ storage });


// S3 Upload helper
const uploadToS3 = (file, folder) => {
  const key = `${folder}/${Date.now()}-${file.originalname}`;
  return s3.upload({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }).promise();
};


const uploadAssetTypeImage = multerInstance.single('image');

// POST /assets
router.post('/', upload, async (req, res) => {
  try {
    const data = req.body;
    const imageFile = req.files?.image?.[0];
    const docFile = req.files?.document?.[0];

    // Validate foreign keys
    if (data.assigned_to_id) {
      const user = await prisma.users.findUnique({ where: { id: data.assigned_to_id } });
      if (!user) return res.status(400).json({ error: 'Assigned user ID does not exist' });
    }

    if (data.type_id) {
      const type = await prisma.asset_types.findUnique({ where: { id: data.type_id } });
      if (!type) return res.status(400).json({ error: 'Asset type ID does not exist' });
    }

    // Find a pre-generated unused ID
    const placeholder = await prisma.assets.findFirst({
      where: {
        serial_number: null,
        model: null,
        assigned_to_id: null,
        type_id: null,
        documentation_url: null,
        image_url: null,
      },
    });

    if (!placeholder) {
      return res.status(400).json({ error: 'No available pre-generated asset IDs. Please generate more QR codes.' });
    }

    const [imageUpload, docUpload] = await Promise.all([
      imageFile ? uploadToS3(imageFile, 'images') : null,
      docFile ? uploadToS3(docFile, 'documents') : null,
    ]);

    const updated = await prisma.assets.update({
      where: { id: placeholder.id },
      data: {
        type_id: data.type_id || null,
        serial_number: data.serial_number,
        model: data.model,
        description: data.description,
        location: data.location,
        assigned_to_id: data.assigned_to_id || null,
        status: data.status || 'Available',
        checked_out: data.checked_out === 'true',
        return_date: data.return_date ? new Date(data.return_date) : null,
        next_service_date: data.next_service_date ? new Date(data.next_service_date) : null,
        documentation_url: docUpload?.Location || null,
        image_url: imageUpload?.Location || null,
      },
    });
    // 🔁 Update userassets array if asset assigned
    if (data.assigned_to_id) {
      const assignedUser = await prisma.users.findUnique({ where: { id: data.assigned_to_id } });

      console.log("📦 Assigned user ID:", data.assigned_to_id);
      console.log("📦 Asset ID being assigned:", placeholder.id);
      console.log("📦 Existing userassets:", assignedUser?.userassets);

      if (assignedUser) {
        const currentAssets = assignedUser.userassets || [];
        if (!currentAssets.includes(placeholder.id)) {
          await prisma.users.update({
            where: { id: data.assigned_to_id },
            data: {
              userassets: { set: [...currentAssets, placeholder.id] },
            },
          });
        }
      }
    }

    res.status(201).json({ asset: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creating asset' });
  }
});

router.get('/asset-options', async (req, res) => {
  try {
    const assetTypes = await prisma.asset_types.findMany(); // ✅ correct model name
    const models = []; // add later
    const users = await prisma.users.findMany();
    const statuses = ['Available', 'In Use', 'Rented', 'Maintenance'];

    const placeholderAssets = await prisma.assets.findMany({
      where: {
        assigned_to_id: null,
        status: 'Available',
      },
      select: { id: true },
    });

    const assetIds = placeholderAssets.map(a => a.id);

    console.log('✅ Sending assetIds:', assetIds);

    res.json({
      assetTypes,
      models,
      users,
      statuses,
      assetIds, // ✅ this was previously missing
    });
  } catch (err) {
    console.error('🔥 Error in /asset-options:', err);
    res.status(500).json({ error: 'Failed to fetch dropdown options' });
  }
});





router.get('/asset_types', async (req, res) => {
  try {
    const types = await prisma.asset_types.findMany();
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch asset types' });
  }
});

// ✅ Add to routes/assets.js ABOVE `/:id`
router.get('/asset-types-summary', async (req, res) => {
  try {
    const assetTypes = await prisma.asset_types.findMany();
    const assets = await prisma.assets.findMany({
      select: { type_id: true, status: true },
    });

    const summary = assetTypes.map(type => {
      const filtered = assets.filter(a => a.type_id === type.id);
      return {
        id: type.id,
        name: type.name,
        image_url: type.image_url,
        available: filtered.filter(a => a.status?.toLowerCase() === 'available').length,
        inUse: filtered.filter(a => a.status?.toLowerCase() === 'in use').length,
        rented: filtered.filter(a => a.status?.toLowerCase() === 'rented').length,
      };
    });
    
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch asset type summary' });
  }
});



// PUT update asset
router.put('/:id', async (req, res) => {
  const assetId = req.params.id;
  const { assigned_to_id, assign_to_admin = false, ...assetData } = req.body;

  try {
    let newUserId = assigned_to_id;

    if (assign_to_admin) {
      const adminUser = await prisma.users.findUnique({
        where: { useremail: 'admin@engsurveys.com.au' },
      });
      if (!adminUser) return res.status(400).json({ error: 'Admin user not found' });
      newUserId = adminUser.id;
    }

    const existingAsset = await prisma.assets.findUnique({
      where: { id: assetId },
    });
    if (!existingAsset) return res.status(404).json({ error: 'Asset not found' });

    const prevUserId = existingAsset.assigned_to_id;
    const updateOps = [];

    if (prevUserId && prevUserId !== newUserId) {
      const prevUser = await prisma.users.findUnique({ where: { id: prevUserId } });
      if (prevUser) {
        const filteredAssets = prevUser.userassets.filter(a => a !== assetId);
        updateOps.push(
          prisma.users.update({
            where: { id: prevUserId },
            data: { userassets: { set: filteredAssets } },
          })
        );
      }
    }

    if (newUserId) {
      const newUser = await prisma.users.findUnique({ where: { id: newUserId } });
      if (!newUser) return res.status(400).json({ error: 'Target user not found' });

      if (!newUser.userassets.includes(assetId)) {
        updateOps.push(
          prisma.users.update({
            where: { id: newUserId },
            data: { userassets: { push: assetId } },
          })
        );
      }
    }

    updateOps.push(
      prisma.assets.update({
        where: { id: assetId },
        data: { ...assetData, assigned_to_id: newUserId || null },
      })
    );

    const result = await prisma.$transaction(updateOps);
    res.json({ success: true, updated: result });
  } catch (err) {
    console.error('❌ Failed to update asset:', {
      message: err.message,
      stack: err.stack,
      assetId,
      assigned_to_id,
      assign_to_admin,
      assetData,
    });
    res.status(500).json({ error: 'Failed to update asset', details: err.message });
  }
});



// DELETE asset
router.delete('/:id', async (req, res) => {
  try {
    await prisma.assets.delete({ where: { id: req.params.id } });
    res.json({ message: 'Asset deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/asset-types', multerInstance.single('image'), async (req, res) => {
  try {
    const { name } = req.body;
    const imageFile = req.file;

    if (!name || !imageFile) {
      return res.status(400).json({ error: 'Name and image are required' });
    }

    const uploadResult = await uploadToS3(imageFile, 'asset-type-images');

    const newType = await prisma.asset_types.create({
      data: {
        name,
        image_url: uploadResult.Location,
      },
    });

    res.status(201).json({ assetType: newType });
  } catch (err) {
    console.error('❌ Failed to create asset type:', err);
    res.status(500).json({ error: 'Failed to create asset type' });
  }
});


// GET asset by ID
router.get('/:id', async (req, res) => {
  const asset = await prisma.assets.findUnique({
    where: { id: req.params.id },
    include: {
      asset_types: true,
      users: true,
    },
  });
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(asset);
});
// GET /assets/assigned/:userId - Get assets assigned to a specific user
// GET /assets/assigned/:userId - Get assets assigned to a specific user
router.get('/assigned/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // ✅ Fetch user (NO include)
    const user = await prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // ✅ Query assets by IDs from user's userassets array
    const assets = await prisma.assets.findMany({
      where: {
        id: {
          in: user.userassets || [],
        },
      },
      include: {
        asset_types: true,
        users: true,
      },
    });

    res.json(assets);
  } catch (err) {
    console.error('🔥 Error fetching assigned assets:', err);
    res.status(500).json({ error: 'Failed to fetch assigned assets' });
  }
});


module.exports = router;
