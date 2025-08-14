require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const assetRoutes = require('./routes/assets');
const usersRouter = require('./routes/users');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

app.use('/assets', assetRoutes);
app.use('/users', usersRouter);
app.use('/qr', express.static('/home/ec2-user/deploy/AssetManagementApp/utils/qr'));


app.get('/', (req, res) => {
  res.send('Inventory API is running');
});
app.get('/check-in/:id', (req, res) => {
  const assetId = req.params.id;
  res.json({ message: `Check-in endpoint for asset ${assetId}` });
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
