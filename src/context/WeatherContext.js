import { createContext, useCallback, useContext, useState } from 'react';

// Live weather-along-route state, fed by the driver's own heartbeat responses
// (see useLocationSharing.js). Kept separate from AlertContext, which already
// owns two unrelated things (notification inbox + the mock-only takeover
// simulation) — this is a third, live-data-only concern.
const WeatherContext = createContext(null);

const initial = { weatherNow: null, weatherAlert: null };

// Maps the backend's DTO shape onto exactly what WeatherStrip.js already
// expects from the mock fixtures, so that component needs no changes.
function mapWeatherNow(now) {
  if (!now) return null;
  return { tempF: now.tempF, condition: now.condition, icon: now.iconKey || 'cloud' };
}

// The backend only ever surfaces NWS "Severe"/"Extreme" alerts (Minor/Moderate
// are filtered server-side) — both map to WeatherStrip's single 'severe' tier,
// which is the only value it treats as the danger (vs. caution) tone.
function mapWeatherAlert(alert) {
  if (!alert) return null;
  return { severity: 'severe', title: alert.title, near: alert.near, etaMinutes: alert.etaMinutes, advice: alert.advice };
}

export function WeatherProvider({ children }) {
  const [state, setState] = useState(initial);

  // A heartbeat cycle only actually runs the weather check every ~15 min
  // (throttled server-side) — most calls report `weatherChecked: false` and
  // carry no weather fields at all. On those, keep whatever we last knew
  // instead of blanking the display. Only a cycle that DID check overwrites —
  // including clearing weatherAlert back to null once a warning resolves.
  const setFromHeartbeat = useCallback((result) => {
    if (!result?.weatherChecked) return;
    setState({
      weatherNow: mapWeatherNow(result.weatherNow),
      weatherAlert: mapWeatherAlert(result.weatherAlert),
    });
  }, []);

  return (
    <WeatherContext.Provider value={{ ...state, setFromHeartbeat }}>
      {children}
    </WeatherContext.Provider>
  );
}

export function useWeather() {
  const ctx = useContext(WeatherContext);
  if (!ctx) throw new Error('useWeather must be used within a WeatherProvider');
  return ctx;
}
