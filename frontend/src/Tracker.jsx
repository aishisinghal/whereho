import React from 'react';
import { useLiveLocation } from './hooks/useLiveLocation';

export default function Tracker({ journeyId }) {
  useLiveLocation(journeyId);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ padding: 8, background: '#eef', borderRadius: 6 }}>Live tracking active for {journeyId} — location is being streamed.</div>
    </div>
  );
}
