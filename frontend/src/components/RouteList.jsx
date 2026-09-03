import React, { useState } from 'react';

function secondsToMinLabel(s) {
  const m = Math.round(s / 60);
  return `${m} min`;
}
function metersToKmLabel(m) {
  return `${(m/1000).toFixed(1)} km`;
}

export default function RouteList({ onRoutes, initialOrigin, initialDestination, onStart }) {
  const [loading, setLoading] = useState(false);
  const [routes, setRoutes] = useState([]);
  const [selected, setSelected] = useState(null);

  const findRoutes = async (origin, destination) => {
    setLoading(true);
    try {
      const body = { origin, destination };
      const res = await fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.routes) {
        setRoutes(data.routes);
        onRoutes && onRoutes(data.routes);
        const safest = data.routes.find(r => r.label === 'safest') || data.routes[0];
        setSelected(safest.label);
        onRoutes && onRoutes(data.routes, safest.label);
      } else {
        console.error('routes API error', data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    const sel = routes.find(x => x.label === selected) || routes[0];
    if (!sel) return alert('Select a route first');
    if (onStart) await onStart(sel);
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => findRoutes(initialOrigin, initialDestination)} disabled={loading}>
          {loading ? 'Finding routes...' : 'Find routes'}
        </button>
      </div>
      <div>
        {routes.map(r => (
          <div key={r.label} onClick={() => { setSelected(r.label); onRoutes && onRoutes(routes, r.label); }} style={{
            border: selected === r.label ? `2px solid ${r.color}` : '1px solid #ddd',
            padding: 12, borderRadius: 8, marginBottom: 8, cursor: 'pointer'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong style={{ color: r.color }}>{r.label.toUpperCase()}</strong>
              <div>{secondsToMinLabel(r.duration)} • {metersToKmLabel(r.distance)}</div>
            </div>
            <div style={{ marginTop: 6 }}>Safety: {r.safetyScore} • Police: {r.policeCount} • Hospitals: {r.hospitalCount}</div>
          </div>
        ))}
      </div>
      {routes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button onClick={handleStart}>Start journey</button>
        </div>
      )}
    </div>
  );
}
