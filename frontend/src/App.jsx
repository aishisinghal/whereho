import React, { useEffect, useState } from 'react';
import RouteMap from './components/RouteMap';
import RouteList from './components/RouteList';

export default function App() {
  const [routes, setRoutes] = useState([]);
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [journeyId, setJourneyId] = useState(null);

  // example origin/destination: replace with Places autocomplete UI later
  const origin = { lat: 28.7041, lng: 77.1025 }; // Delhi
  const destination = { lat: 28.5355, lng: 77.3910 }; // Noida

  useEffect(() => {
    // load Google Maps script dynamically
    if (!window.google) {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}&libraries=places,geometry`;
      s.async = true;
      document.head.appendChild(s);
      return () => { document.head.removeChild(s); };
    }
  }, []);

  const handleRoutes = (rs, sel) => {
    setRoutes(rs || []);
    if (sel) setSelectedLabel(sel);
  };

  const handleStart = async (selectedRoute) => {
    try {
      const body = { userId: 'demo_user', userName: 'Demo User', route: selectedRoute, origin, destination };
      const res = await fetch('/api/journeys/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.journeyId) {
        setJourneyId(data.journeyId);
        alert(`Journey started: ${data.journeyId}`);
      } else {
        console.error('start journey failed', data);
      }
    } catch (err) { console.error(err); }
  };

  return (
    <div>
      <h1>Whereहो — Routes</h1>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <RouteList initialOrigin={origin} initialDestination={destination} onRoutes={handleRoutes} onStart={handleStart} />
          {journeyId && <div style={{ marginTop: 12 }}><strong>Active journey:</strong> {journeyId}</div>}
        </div>
        <div style={{ flex: 2 }}>
          <RouteMap center={origin} routes={routes} selectedLabel={selectedLabel} onSelect={(label) => setSelectedLabel(label)} />
        </div>
      </div>
    </div>
  );
}
