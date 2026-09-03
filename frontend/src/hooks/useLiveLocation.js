// frontend/src/hooks/useLiveLocation.js
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

export function useLiveLocation(journeyId) {
  const socketRef = useRef(null);
  const watchIdRef = useRef(null);

  useEffect(() => {
    if (!journeyId) return;
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('live socket connected', socket.id);
      socket.emit('joinJourney', { journeyId });
    });

    // start geolocation watch
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition((pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        socket.emit('location', { journeyId, lat, lng });
      }, (err) => {
        console.error('geolocation error', err);
      }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
    } else {
      console.warn('Geolocation not supported');
    }

    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [journeyId]);
}
