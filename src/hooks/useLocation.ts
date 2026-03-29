import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

export interface LocationData {
  city: string | null;
  coords: { latitude: number; longitude: number } | null;
  loading: boolean;
  error: string | null;
}

export const useLocation = (): LocationData => {
  const [location, setLocation] = useState<LocationData>({
    city: null,
    coords: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    (async () => {
      console.log("[useLocation] Start fetching...");
      try {
        // Permissions
        const permPromise = Location.requestForegroundPermissionsAsync();
        const permTimeout = new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Timeout permission")), 8000));
        let { status } = await Promise.race([permPromise, permTimeout]);
        
        if (status !== 'granted') {
          console.warn("[useLocation] Permission denied");
          setLocation(prev => ({ ...prev, loading: false, error: '位置情報の許可がありません' }));
          return;
        }

        // Position
        console.log("[useLocation] Fetching position...");
        const posPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const posTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout position")), 12000));
        let loc: any = await Promise.race([posPromise, posTimeout]);
        
        const { latitude, longitude } = loc.coords;
        console.log(`[useLocation] Position found: ${latitude}, ${longitude}`);

        // Set initial state - NOT showing coordinates in the UI yet
        setLocation({
          city: null, // Keep UI in "Searching..." state until name is ready
          coords: { latitude, longitude },
          loading: false,
          error: null,
        });

        // Background Reverse Geocoding
        (async () => {
          try {
            console.log("[useLocation] Resolving area name...");
            const reverse = await Location.reverseGeocodeAsync({ latitude, longitude });
            let cityName = "現在地";
            if (reverse && reverse.length > 0) {
              cityName = reverse[0].city || reverse[0].district || reverse[0].region || reverse[0].name || "現在地";
            }
            console.log(`[useLocation] Area name resolved: ${cityName}`);
            setLocation(prev => ({ ...prev, city: cityName }));
          } catch (e) {
            console.warn("[useLocation] Area resolution failed, falling back to '現在地'");
            setLocation(prev => ({ ...prev, city: '現在地' }));
          }
        })();
      } catch (e: any) {
        console.error("[useLocation] Critical error:", e.message);
        setLocation(prev => ({ ...prev, loading: false, error: e.message }));
      }
    })();
  }, []);

  return location;
};
