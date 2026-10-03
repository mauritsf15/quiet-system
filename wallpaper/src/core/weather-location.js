import { weatherEndpoint, fetchWeather } from "./weather-request.js";

export function normalizeLocation(value) {
  if (!value || typeof value !== "object" ||
      !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
      !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) return null;
  return {
    latitude: Math.round(value.latitude * 1000) / 1000,
    longitude: Math.round(value.longitude * 1000) / 1000,
    name: typeof value.name === "string" && value.name.trim()
      ? value.name.trim().slice(0, 120) : "Current location",
  };
}

export async function searchLocations(query, { signal } = {}) {
  if (query.trim().length < 2) return [];
  const url = weatherEndpoint("locations");
  url.searchParams.set("name", query.trim());
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "en");
  const response = await fetchWeather(url, { signal });
  if (!response.ok) throw new Error("City search could not connect. Please try again.");
  const payload = await response.json();
  return (payload.results || []).map((place) => normalizeLocation({
    latitude: place.latitude, longitude: place.longitude,
    name: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
  })).filter(Boolean);
}

export function detectLocation() {
  return new Promise((resolve, reject) => {
    if (!globalThis.navigator?.geolocation) {
      reject(new Error("Location detection is unavailable here. Search for your city instead."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = normalizeLocation({
          latitude: position.coords.latitude, longitude: position.coords.longitude,
          name: "Current location" });
        if (location) resolve(location);
        else reject(new Error("Location could not be determined. Search for your city instead."));
      },
      () => reject(new Error("Location was denied or unavailable. Search for your city instead.")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}
