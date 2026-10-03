import { temperature } from "../core/format.js";

const ids = [
  "header-time", "header-seconds", "header-date", "clock-hours", "clock-minutes",
  "clock-seconds", "clock-date", "clock-weekday", "clock-weather", "weather-line",
];
const element = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

function updateClock(state) {
  const now = new Date();
  const hourCycle = state.settings.clock24Hour ? "h23" : "h12";
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle }).formatToParts(now);
  const hours = parts.find((part) => part.type === "hour")?.value ?? "--";
  const minutes = parts.find((part) => part.type === "minute")?.value ?? "--";
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(now).toUpperCase();
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(now).toUpperCase();

  element["header-time"].textContent = `${hours}:${minutes}`;
  element["header-seconds"].textContent = seconds;
  element["header-date"].textContent = `${weekday} · ${date}`;
  element["clock-hours"].textContent = hours;
  element["clock-minutes"].textContent = minutes;
  element["clock-seconds"].textContent = seconds;
  element["clock-weekday"].textContent = weekday;
  element["clock-date"].textContent = date;

  const weather = state.weather;
  const weatherText = weather.available
    ? `WASSENAAR · ${temperature(weather.temperatureC, state.settings.temperatureUnit)} · ${weather.condition.toUpperCase()}`
    : `WASSENAAR · ${weather.condition.toUpperCase()}`;
  element["clock-weather"].textContent = weatherText;
  element["weather-line"].textContent = `weather / ${weatherText.toLowerCase()}`;
  element["clock-weather"].hidden = !state.settings.showWeather;
  element["weather-line"].hidden = !state.settings.showWeather;
  document.querySelector(".clock-stage").classList.toggle("clock-stage--hidden", !state.settings.showClock);
}

export function startClock(store) {
  const render = () => updateClock(store.getState());
  render();
  const timer = window.setInterval(render, 1000);
  const unsubscribe = store.subscribe(render);
  return () => {
    window.clearInterval(timer);
    unsubscribe();
  };
}
