// routes/places.js
const express = require('express');
const https = require('https');
const router = express.Router();

const API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
const COUNTRY = (process.env.GOOGLE_PLACES_COUNTRY || 'AU').trim(); // ISO country code
const BIAS_LOCATION = (process.env.GOOGLE_PLACES_LOCATION || '').trim(); // "lat,lng"
const BIAS_RADIUS   = Number(process.env.GOOGLE_PLACES_RADIUS || 0);     // meters

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

router.get('/autocomplete', async (req, res) => {
  try {
    if (!API_KEY) return res.status(400).json({ error: 'GOOGLE_PLACES_API_KEY missing on server' });
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ predictions: [] });

    const params = new URLSearchParams({
      input: q,
      key: API_KEY,
    });
    if (COUNTRY) {
      params.set('components', `country:${COUNTRY.toUpperCase()}`);
      params.set('region', COUNTRY.toLowerCase()); // bias
    }
    if (BIAS_LOCATION && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(BIAS_LOCATION)) {
      params.set('location', BIAS_LOCATION);
      if (BIAS_RADIUS > 0) params.set('radius', String(BIAS_RADIUS));
      params.set('strictbounds', 'true'); // stronger biasing (best-effort)
    }
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`;
    const json = await getJSON(url);
    const predictions = Array.isArray(json.predictions)
      ? json.predictions.map((p) => ({
          id: p.place_id,
          description: p.description,
          main: p.structured_formatting?.main_text,
          secondary: p.structured_formatting?.secondary_text,
        }))
      : [];
    res.json({ predictions });
  } catch (err) {
    res.status(500).json({ error: 'places-autocomplete-failed', message: err.message });
  }
});

router.get('/details', async (req, res) => {
  try {
    if (!API_KEY) return res.status(400).json({ error: 'GOOGLE_PLACES_API_KEY missing on server' });
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });

    const params = new URLSearchParams({
      place_id: id,
      key: API_KEY,
      fields: 'formatted_address,geometry/location',
    });
    const url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
    const json = await getJSON(url);
    const r = json.result || {};
    const out = {
      formatted_address: r.formatted_address || '',
      location: r.geometry?.location || null, // { lat, lng }
    };
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'places-details-failed', message: err.message });
  }
});

module.exports = router;
