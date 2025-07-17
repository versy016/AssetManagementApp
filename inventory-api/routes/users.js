const express = require('express');
const router = express.Router();
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

router.post('/', async (req, res) => {
  const { id, name, useremail } = req.body;
 
  if (!id || !name) {
    return res.status(400).json({ error: 'Missing id or name' });
  }

  try {
    const newUser = await prisma.users.create({
      data: {
        id,
        name,
        useremail,
        userassets: [],
      },
    });

    res.status(201).json(newUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});
// POST /users/:id/assign-asset
// Assign asset to user
router.post('/:userId/assign-asset', async (req, res) => {
  const { userId } = req.params;
  const { assetId } = req.body;

  if (!assetId) {
    return res.status(400).json({ error: 'Missing assetId in body' });
  }

  try {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const asset = await prisma.assets.findUnique({ where: { id: assetId } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    // Update the asset's assigned user
    await prisma.assets.update({
      where: { id: assetId },
      data: { assigned_to_id: userId },
    });

    // Update the user's userassets array if needed
    if (!user.userassets.includes(assetId)) {
      await prisma.users.update({
        where: { id: userId },
        data: {
          userassets: { push: assetId },
        },
      });
    }

    res.json({ message: 'Asset successfully assigned to user', assetId, userId });
  } catch (err) {
    console.error('❌ Asset assignment error:', err);
    res.status(500).json({ error: 'Failed to assign asset' });
  }
});


router.put('/:id', async (req, res) => {
  try {
    const updatedUser = await prisma.users.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(updatedUser);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Failed to update user' });
  }
});

router.get('/', async (req, res) => {
  try {
    console.log('📥 GET /users called');

    const users = await prisma.users.findMany(); // ✅ Fetch all users

    console.log('📤 Fetched users:', users);

    res.json(users); // ✅ Return users as JSON
  } catch (err) {
    console.error('❌ Failed to fetch users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});


// ✅ Get user by ID
router.get('/:id', async (req, res) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: req.params.id },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('❌ Failed to fetch user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

                                                                       
module.exports = router; 
