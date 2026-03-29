import { Linking } from 'react-native';

export interface TravelTimes {
  driving: number;  // minutes
  transit: number;  // minutes (estimated from straight-line distance)
  walking: number;  // minutes
}

/**
 * Geocodes a destination string to lat/lng using Nominatim (free, no API key)
 */
const geocodeDestination = async (destination: string): Promise<{ lat: number; lng: number } | null> => {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1&countrycodes=jp`;
    const res = await fetch(url, { headers: { 'User-Agent': 'ADHD-Manager-App/1.0' } });
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Calculates straight-line distance in km using the Haversine formula
 */
const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Fetches routing duration from OSRM public server (free, no API key)
 * profile: 'driving' | 'foot'
 */
const getOsrmMinutes = async (
  originLat: number, originLng: number,
  destLat: number, destLng: number,
  profile: 'driving' | 'foot'
): Promise<number | null> => {
  try {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${originLng},${originLat};${destLng},${destLat}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes.length > 0) {
      return Math.round(data.routes[0].duration / 60);
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Returns travel times for driving, transit (estimated), and walking.
 * Car + Walking: OSRM (real routing)
 * Transit: straight-line distance ÷ 40km/h + 10min station overhead
 */
export const getTravelTimes = async (
  originCoords: { latitude: number; longitude: number },
  destination: string
): Promise<TravelTimes | null> => {
  const destCoords = await geocodeDestination(destination);
  if (!destCoords) return null;

  const { latitude: oLat, longitude: oLng } = originCoords;
  const { lat: dLat, lng: dLng } = destCoords;

  const distKm = haversineKm(oLat, oLng, dLat, dLng);

  const [driving, walking] = await Promise.all([
    getOsrmMinutes(oLat, oLng, dLat, dLng, 'driving'),
    getOsrmMinutes(oLat, oLng, dLat, dLng, 'foot'),
  ]);

  // 電車概算: 距離に応じて速度モデルを変える（短距離=在来線、長距離=新幹線）
  let transitMinutes: number;
  if (distKm < 20) {
    transitMinutes = Math.round(distKm / 30 * 60) + 10; // 在来線 ~30km/h + 乗換10分
  } else if (distKm < 100) {
    transitMinutes = Math.round(distKm / 60 * 60) + 15; // 特急 ~60km/h
  } else {
    transitMinutes = Math.round(distKm / 200 * 60) + 30; // 新幹線 ~200km/h + 乗換30分
  }

  // OSRM foot が車と同等以下の時間を返した場合は信頼せず直線距離で計算
  const drivingMin = driving ?? Math.round(distKm / 40 * 60);
  let walkingMin: number;
  if (walking !== null && walking > drivingMin) {
    walkingMin = walking;
  } else {
    walkingMin = Math.round(distKm / 5 * 60);
  }

  return {
    driving: drivingMin,
    walking: walkingMin,
    transit: transitMinutes,
  };
};

/**
 * Generates a Google Maps Direction URL
 */
export const getGoogleMapsUrl = (
  origin: string | null,
  destination: string,
  mode: 'driving' | 'walking' | 'transit' = 'driving'
): string => {
  const originParam = origin ? encodeURIComponent(origin) : '';
  const destParam = encodeURIComponent(destination);
  return `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destParam}&travelmode=${mode}`;
};

/**
 * Opens the Google Maps app/web with the specified route
 */
export const openGoogleMaps = async (
  origin: string | null,
  destination: string,
  mode: 'driving' | 'walking' | 'transit' = 'driving'
) => {
  const url = getGoogleMapsUrl(origin, destination, mode);
  await Linking.openURL(url);
};
