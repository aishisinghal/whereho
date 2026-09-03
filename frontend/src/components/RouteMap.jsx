import React, { useEffect, useRef } from 'react';

export default function RouteMap({ center = { lat: 28.7041, lng: 77.1025 }, routes = [], selectedLabel, onSelect }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const polylinesRef = useRef({});

  useEffect(() => {
    if (!window.google) return;
    if (!mapInstance.current) {
      mapInstance.current = new window.google.maps.Map(mapRef.current, {
        center,
        zoom: 13,
      });
    }
  }, [center]);

  useEffect(() => {
    if (!window.google || !mapInstance.current) return;
    // clear old polylines not in routes
    const toKeep = new Set(routes.map(r => r.label));
    for (const key of Object.keys(polylinesRef.current)) {
      if (!toKeep.has(key)) {
        polylinesRef.current[key].setMap(null);
        delete polylinesRef.current[key];
      }
    }

    // draw/update polylines
    const bounds = new window.google.maps.LatLngBounds();
    routes.forEach(r => {
      if (!r.poly) return;
      const path = window.google.maps.geometry.encoding.decodePath(r.poly);
      path.forEach(ll => bounds.extend(ll));
      if (!polylinesRef.current[r.label]) {
        polylinesRef.current[r.label] = new window.google.maps.Polyline({
          map: mapInstance.current,
          path,
          strokeColor: r.color,
          strokeOpacity: r.label === selectedLabel ? 1.0 : 0.6,
          strokeWeight: r.label === selectedLabel ? 6 : 4,
          clickable: true,
          zIndex: r.label === selectedLabel ? 10 : 1,
        });
        polylinesRef.current[r.label].addListener('click', () => onSelect && onSelect(r.label));
      } else {
        polylinesRef.current[r.label].setPath(path);
        polylinesRef.current[r.label].setOptions({
          strokeOpacity: r.label === selectedLabel ? 1.0 : 0.6,
          strokeWeight: r.label === selectedLabel ? 6 : 4,
          zIndex: r.label === selectedLabel ? 10 : 1,
        });
      }
    });

    if (!bounds.isEmpty()) mapInstance.current.fitBounds(bounds);
  }, [routes, selectedLabel, onSelect]);

  return <div ref={mapRef} style={{ width: '100%', height: '70vh', borderRadius: 8, overflow: 'hidden' }} />;
}
