const express = require('express');
const fetch = require('node-fetch');
const { decodePolyline, samplePoints } = require('../utils/polyline');

const router = express.Router();
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!GOOGLE_KEY) console.warn('[directions] GOOGLE_MAPS_API_KEY not set in env');

// POST /api/routes
// body: { origin: {lat,lng} or 'place string', destination: {lat,lng} or 'place string' }
router.post('/routes', async (req, res) => {
  try {
    const { origin, destination } = req.body;
    if (!origin || !destination) return res.status(400).json({ error: 'origin and destination required' });

    const originParam = typeof origin === 'string' ? encodeURIComponent(origin) : `${origin.lat},${origin.lng}`;
    const destParam = typeof destination === 'string' ? encodeURIComponent(destination) : `${destination.lat},${destination.lng}`;

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originParam}&destination=${destParam}&alternatives=true&key=${GOOGLE_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.status !== 'OK') return res.status(500).json({ error: 'Directions error', details: data });

    const routes = data.routes || [];
    // For each route compute safety score by sampling points and calling Places Nearby (police/hospital)
    const scoredRoutes = [];
    for (const route of routes) {
      const poly = route.overview_polyline && route.overview_polyline.points;
      const points = decodePolyline(poly);
      const samples = samplePoints(points, 10); // sample every ~10th point

      // collect unique place_ids
      const policeSet = new Set();
      const hospitalSet = new Set();
      for (const p of samples) {
        // Places Nearby Search for police
        const loc = `${p.lat},${p.lng}`;
        // police
        const policeUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?key=${GOOGLE_KEY}&location=${loc}&radius=200&type=police`;
        const hospUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?key=${GOOGLE_KEY}&location=${loc}&radius=200&type=hospital`;
        try {
          const [pr, hr] = await Promise.all([fetch(policeUrl), fetch(hospUrl)]);
          const [pdata, hdata] = await Promise.all([pr.json(), hr.json()]);
          if (pdata.status === 'OK') pdata.results.forEach(pl => policeSet.add(pl.place_id));
          if (hdata.status === 'OK') hdata.results.forEach(hp => hospitalSet.add(hp.place_id));
        } catch (err) {
          console.warn('places lookup error', err);
        }
      }

      const policeCount = policeSet.size;
      const hospitalCount = hospitalSet.size;
      const duration = route.legs.reduce((s,l) => s + (l.duration && l.duration.value || 0), 0);
      const distance = route.legs.reduce((s,l) => s + (l.distance && l.distance.value || 0), 0);

      // compute simple safety score
      const policeScore = Math.tanh(policeCount / 3);
      const hospScore = Math.tanh(hospitalCount / 2);
      const crimeScore = 1; // placeholder (no data)
      const lightScore = 0.8; // placeholder

      const weights = { police: 0.45, hospital: 0.25, light: 0.15, crime: 0.15 };
      const combined = policeScore * weights.police + hospScore * weights.hospital + lightScore * weights.light + crimeScore * weights.crime;
      const safetyScore = Math.round(combined * 100);

      scoredRoutes.push({
        route, duration, distance, safetyScore, policeCount, hospitalCount, poly
      });
    }

    if (scoredRoutes.length === 0) return res.status(404).json({ error: 'no routes found' });

    // identify fastest, safest, and balanced
    scoredRoutes.sort((a,b) => a.duration - b.duration);
    const fastest = scoredRoutes[0];
    scoredRoutes.sort((a,b) => b.safetyScore - a.safetyScore);
    const safest = scoredRoutes[0];

    // balanced: maximize (safetyScore - alpha * normalizedDuration)
    const minDuration = Math.min(...scoredRoutes.map(r => r.duration));
    const alpha = 10; // penalty weight (tune)
    let balanced = scoredRoutes[0];
    let bestVal = -Infinity;
    for (const r of scoredRoutes) {
      const normTime = r.duration / minDuration;
      const val = r.safetyScore - alpha * (normTime - 1);
      if (val > bestVal) { bestVal = val; balanced = r; }
    }

    const unique = new Map();
    unique.set('fastest', fastest);
    unique.set('safest', safest);
    unique.set('balanced', balanced);

    const out = [];
    for (const [label, r] of unique.entries()) {
      out.push({ label, color: label === 'safest' ? 'green' : label === 'balanced' ? 'yellow' : 'red', duration: r.duration, distance: r.distance, safetyScore: r.safetyScore, policeCount: r.policeCount, hospitalCount: r.hospitalCount, poly: r.poly, summary: r.route.summary || '' });
    }

    return res.json({ routes: out });
  } catch (err) {
    console.error('routes error', err);
    res.status(500).json({ error: String(err) });
  }
});

module.exports = router;
