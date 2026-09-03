// utils/polyline.js
// minimal polyline decoder and sampler

function decodePolyline(str) {
  // returns array of {lat, lng}
  let index = 0, lat = 0, lng = 0, points = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function samplePoints(points, step = 10) {
  if (!points || points.length === 0) return [];
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  // ensure last point included
  if (points.length > 0 && (out.length === 0 || out[out.length-1] !== points[points.length-1])) out.push(points[points.length-1]);
  return out;
}

module.exports = { decodePolyline, samplePoints };
