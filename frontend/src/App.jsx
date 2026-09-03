import React, { useEffect } from 'react';
import io from 'socket.io-client';

function SOSButton({ journeyId }) {
  const onSOS = async () => {
    // discreet verification can be added here (WebAuthn or PIN)
    try {
      const res = await fetch('/api/sos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ journeyId, userId: 'demo_user', userName: 'Demo User' }) });
      const data = await res.json();
      console.log('SOS result', data);
      // open phone dialer for 100
      window.location.href = 'tel:100';
    } catch (err) { console.error(err); }
  };

  return (
    <button onClick={onSOS} style={{ position: 'fixed', bottom: 24, right: 24, background: 'red', color: 'white', padding: 16, borderRadius: 12, fontSize: 18 }}>I feel unsafe</button>
  );
}

export default function App() {
  useEffect(() => {
    // load Google Maps script dynamically (requires GOOGLE_MAPS_API_KEY in env during build)
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}&libraries=places`;
    s.async = true;
    document.head.appendChild(s);
    return () => { document.head.removeChild(s); };
  }, []);

  // demo: connect socket to receive live location updates for a demo journey
  useEffect(() => {
    const socket = io('/', { path: '/socket.io' });
    socket.emit('joinJourney', { journeyId: 'demo-journey' });
    socket.on('locationUpdate', (loc) => console.log('live loc', loc));
    return () => socket.disconnect();
  }, []);

  return (
    <div>
      <h1>Whereहो (demo)</h1>
      <p>Prototype frontend. Map and routing UI will be added here. The SOS button is visible at bottom-right.</p>
      <SOSButton journeyId={'demo-journey'} />
    </div>
  );
}
