// script.js
// Ключевые моменты:
//  - Используем open-meteo.com (без ключа)
//  - Для autocomplete используем жестко захардкоденный CITY_DB (имя -> lat/lon)
//  - Иконки: основные погоды — в папке img/amcharts_weather_icons_1.0.0/
//    дополнительные иконки (search, update, day.svg, thermometer и т.д.) — в img/
//  - localStorage ключ: "weather_app_state"

const STATE_KEY = 'weather_app_state_v1';

// Простой DB городов для autocomplete (можно расширить)
const CITY_DB = [
  { name: 'Санкт-Петербург', lat:59.9311, lon:30.3609 },
  { name: 'Москва', lat:55.7558, lon:37.6173 },
  { name: 'Казань', lat:55.7903, lon:49.1120 },
  { name: 'Новосибирск', lat:55.0084, lon:82.9357 },
  { name: 'Екатеринбург', lat:56.8389, lon:60.6057 },
  { name: 'Нижний Новгород', lat:56.2965, lon:43.9361 },
  { name: 'Самара', lat:53.2415, lon:50.2212 },
  { name: 'Омск', lat:54.9893, lon:73.3686 },
  { name: 'Ростов-на-Дону', lat:47.2357, lon:39.7015 },
  { name: 'Краснодар', lat:45.0355, lon:38.9753 }
];

// state: { current: {type:'geo'|'city', label, lat, lon }, cities: [ {label,lat,lon} ] }
let appState = { current: null, cities: [] };

const el = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

// Иконки - mapping open-meteo weathercode -> filename (amcharts icons)
const WEATHER_CODE_TO_ICON = {
  // 0: Clear
  0: 'day.svg',
  // 1,2,3: Mainly clear, partly cloudy, cloudy
  1: 'cloudy-day-1.svg',
  2: 'cloudy-day-2.svg',
  3: 'cloudy.svg',
  // 45,48 fog
  45: 'cloudy-night-1.svg',
  48: 'cloudy-night-2.svg',
  // 51-67 drizzle/rain
  51: 'rainy-1.svg',
  53: 'rainy-3.svg',
  55: 'rainy-5.svg',
  56: 'rainy-2.svg',
  57: 'rainy-4.svg',
  61: 'rainy-3.svg',
  63: 'rainy-4.svg',
  65: 'rainy-5.svg',
  66: 'rainy-2.svg',
  67: 'rainy-6.svg',
  // Snow
  71: 'snowy-1.svg',
  73: 'snowy-3.svg',
  75: 'snowy-5.svg',
  77: 'snowy-2.svg',
  80: 'rainy-5.svg',
  81: 'rainy-6.svg',
  82: 'rainy-7.svg',
  85: 'snowy-4.svg',
  86: 'snowy-6.svg',
  // thunder
  95: 'thunder.svg',
  96: 'thunder.svg',
  99: 'thunder.svg'
};

// Compose icon path. User said icons are in img/amcharts_weather_icons_1.0.0
function iconPath(name){
  return `img/amcharts_weather_icons_1.0.0/${name}`;
}

// utilities
function saveState(){
  localStorage.setItem(STATE_KEY, JSON.stringify(appState));
}
function loadState(){
  const raw = localStorage.getItem(STATE_KEY);
  if(raw) {
    try { appState = JSON.parse(raw); } catch(e){ console.warn('invalid state'); }
  }
}

// UI pointers
const searchInput = el('searchInput');
const searchBtn = el('searchBtn');
const autocomplete = el('autocomplete');
const refreshBtn = el('refreshBtn');
const locationHeader = el('locationHeader');
const bigTemp = el('bigTemp');
const bigIcon = el('bigIcon');
const smallDesc = el('smallDesc');
const forecastList = el('forecastList');
const feelsLike = el('feelsLike');
const windEl = el('wind');
const humidityEl = el('humidity');
const sunriseEl = el('sunrise');
const sunsetEl = el('sunset');
const citiesList = el('citiesList');
const addCityForm = el('addCityForm');
const addCityInput = el('addCityInput');
const addAutocomplete = el('addAutocomplete');
const addCityError = el('addCityError');
const geoModal = el('geoModal');
const geoRetry = el('geoRetry');
const geoManual = el('geoManual');

async function init(){
  loadState();
  attachEvents();

  if(appState.current){
    // restore saved location
    renderCities();
    await loadAndRenderFor(appState.current);
    return;
  }

  // No saved current: ask for geolocation
  try {
    const pos = await requestGeolocation();
    const { latitude: lat, longitude: lon } = pos.coords;
    appState.current = { type:'geo', label: 'Текущее местоположение', lat, lon };
    saveState();
    renderCities();
    await loadAndRenderFor(appState.current);
  } catch(err){
    // user denied or error -> show modal to let user enter city
    console.warn('geolocation failed', err);
    showGeoModal();
  }
}

function attachEvents(){
  // search header
  searchInput.addEventListener('input', e => showAutocomplete(e.target.value, autocomplete));
  searchBtn.addEventListener('click', onSearchClick);

  // add city form
  addCityForm.addEventListener('submit', e => {
    e.preventDefault();
    addCity(addCityInput.value);
  });
  addCityInput.addEventListener('input', e => showAutocomplete(e.target.value, addAutocomplete));
  addAutocomplete.addEventListener('click', e => {
    if(e.target.matches('.item')){
      addCityInput.value = e.target.textContent;
      addAutocomplete.style.display = 'none';
    }
  });

  // refresh
  refreshBtn.addEventListener('click', async () => {
    // обновить данные для текущего и всех городов (не reload)
    await refreshAll();
  });

  // modal
  geoRetry.addEventListener('click', async () => {
    geoModal.classList.add('hidden');
    try {
      const pos = await requestGeolocation();
      const { latitude: lat, longitude: lon } = pos.coords;
      appState.current = { type:'geo', label:'Текущее местоположение', lat, lon };
      saveState();
      renderCities();
      await loadAndRenderFor(appState.current);
    } catch(err){
      showGeoModal();
    }
  });
  geoManual.addEventListener('click', () => {
    geoModal.classList.add('hidden');
    // show manual input - focus to form
    addCityInput.focus();
  });

  // click outside to hide autocomplete
  document.addEventListener('click', e => {
    if(!searchInput.contains(e.target) && !autocomplete.contains(e.target)) autocomplete.style.display='none';
    if(!addCityInput.contains(e.target) && !addAutocomplete.contains(e.target)) addAutocomplete.style.display='none';
  });

  // autocomplete selection (header)
  autocomplete.addEventListener('click', async (e) => {
    if(e.target.matches('.item')){
      const name = e.target.textContent;
      const rec = CITY_DB.find(c => c.name === name);
      if(rec){
        appState.current = { type:'city', label: rec.name, lat: rec.lat, lon: rec.lon };
        saveState();
        renderCities();
        await loadAndRenderFor(appState.current);
        autocomplete.style.display='none';
      }
    }
  });
}

function showGeoModal(){ geoModal.classList.remove('hidden'); }

// request geolocation as Promise
function requestGeolocation(){
  return new Promise((resolve, reject) => {
    if(!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy:false, timeout:10000 });
  });
}

// autocomplete rendering
function showAutocomplete(text, container){
  const q = (text || '').trim().toLowerCase();
  if(!q){ container.style.display = 'none'; return; }
  const matches = CITY_DB.filter(c => c.name.toLowerCase().startsWith(q)).slice(0,8);
  if(matches.length === 0){ container.style.display = 'none'; return; }
  container.innerHTML = '';
  matches.forEach(m => {
    const div = document.createElement('div');
    div.className = 'item';
    div.textContent = m.name;
    container.appendChild(div);
  });
  container.style.display = 'block';
}

// search header button
async function onSearchClick(){
  const txt = searchInput.value.trim();
  if(!txt) return;
  const rec = CITY_DB.find(c => c.name.toLowerCase() === txt.toLowerCase());
  if(!rec){
    alert('Город не найден в списке подсказок. Введи один из доступных городов.');
    return;
  }
  appState.current = { type:'city', label: rec.name, lat: rec.lat, lon: rec.lon };
  saveState();
  renderCities();
  await loadAndRenderFor(appState.current);
  autocomplete.style.display = 'none';
}

// add city from right panel form
function addCity(name){
  addCityError.textContent = '';
  const txt = (name || '').trim();
  if(!txt){ addCityError.textContent = 'Введите название города'; return; }
  const rec = CITY_DB.find(c => c.name.toLowerCase() === txt.toLowerCase());
  if(!rec){ addCityError.textContent = 'Город не найден в подсказках'; return; }
  // disallow duplicates
  if(appState.cities.some(c => c.label === rec.name) || (appState.current && appState.current.label === rec.name)){
    addCityError.textContent = 'Город уже добавлен';
    return;
  }
  appState.cities.push({ label: rec.name, lat: rec.lat, lon: rec.lon });
  saveState();
  addCityInput.value = '';
  renderCities();
  // eager fetch data for added city (but focus main remains current)
  fetchAndCache(rec.lat, rec.lon, rec.name).catch(console.error);
}

function renderCities(){
  citiesList.innerHTML = '';
  // show current (as selected)
  if(appState.current){
    const li = document.createElement('li');
    li.innerHTML = `<strong>${appState.current.label}</strong> <button data-type="current">Текущий</button>`;
    citiesList.appendChild(li);
  }

  appState.cities.forEach((c, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${c.label}</span>
      <div>
        <button data-index="${i}" class="view-city">Показать</button>
        <button data-index="${i}" class="remove-city">✖</button>
      </div>`;
    citiesList.appendChild(li);
  });

  // listeners for list
  citiesList.querySelectorAll('.view-city').forEach(btn => btn.addEventListener('click', async (e) => {
    const i = +e.target.dataset.index;
    const rec = appState.cities[i];
    if(rec){
      appState.current = { type:'city', label: rec.label, lat: rec.lat, lon: rec.lon };
      saveState();
      await loadAndRenderFor(appState.current);
    }
  }));
  citiesList.querySelectorAll('.remove-city').forEach(btn => btn.addEventListener('click', (e) => {
    const i = +e.target.dataset.index;
    appState.cities.splice(i,1);
    saveState();
    renderCities();
  }));
}

// fetch weather and render (for a given place object {label,lat,lon})
async function loadAndRenderFor(place){
  try {
    showLoadingUI();
    const data = await fetchWeather(place.lat, place.lon);
    renderWeather(place.label, data);
    hideLoadingUI();
  } catch(err){
    hideLoadingUI();
    showErrorUI(err);
  }
}

// refresh current + all added cities (re-fetch)
async function refreshAll(){
  try {
    showLoadingUI();
    if(appState.current) await fetchAndCache(appState.current.lat, appState.current.lon, appState.current.label);
    // fetch additional cities in background
    const promises = appState.cities.map(c => fetchAndCache(c.lat, c.lon, c.label));
    await Promise.all(promises);
    // re-render current
    if(appState.current){
      const cached = getCache(appState.current.lat, appState.current.lon);
      if(cached) renderWeather(appState.current.label, cached);
    }
    hideLoadingUI();
  } catch(err){
    hideLoadingUI();
    showErrorUI(err);
  }
}

/* ---------- Network: open-meteo ----------
We request:
 - current_weather=true
 - hourly=relativehumidity_2m (to extract humidity at current hour)
 - daily=temperature_2m_max,temperature_2m_min,weathercode,sunrise,sunset
 - timezone=auto
------------------------------------------*/
async function fetchWeather(lat, lon){
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m&daily=temperature_2m_max,temperature_2m_min,weathercode,sunrise,sunset&timezone=auto`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('Ошибка запроса погоды');
  const json = await res.json();
  // include lat/lon for cache key
  json._meta = { lat, lon, fetchedAt: Date.now() };
  return json;
}

// Simple caching in localStorage (separate from appState)
// Key by lat_lon
function cacheKey(lat, lon){ return `we_${lat.toFixed(3)}_${lon.toFixed(3)}`;}
function setCache(lat, lon, data){ localStorage.setItem(cacheKey(lat,lon), JSON.stringify(data)); }
function getCache(lat, lon){
  const raw = localStorage.getItem(cacheKey(lat,lon));
  if(!raw) return null;
  try { return JSON.parse(raw); } catch(e){ return null; }
}

async function fetchAndCache(lat, lon, label){
  const data = await fetchWeather(lat, lon);
  setCache(lat, lon, data);
  return data;
}

/* ---------- UI renderers ---------- */

function showLoadingUI(){
  locationHeader.textContent = 'Загрузка...';
  bigTemp.textContent = '...';
  smallDesc.textContent = '';
  forecastList.innerHTML = '';
  feelsLike.textContent = '...';
  windEl.textContent = '...';
  humidityEl.textContent = '...';
  sunriseEl.textContent = '--:--';
  sunsetEl.textContent = '--:--';
}

function hideLoadingUI(){
  // nothing special for now
}

function showErrorUI(err){
  console.error(err);
  locationHeader.textContent = 'Ошибка загрузки';
  bigTemp.textContent = '--';
  smallDesc.textContent = '' + (err.message || err);
  forecastList.innerHTML = '';
}

function renderWeather(label, data){
  // label: заголовок (например 'Текущее местоположение' или 'Санкт-Петербург')
  locationHeader.textContent = label;

  // current temp
  const cur = data.current_weather || {};
  const temp = (cur.temperature !== undefined) ? `${Math.round(cur.temperature)}°` : '—';
  bigTemp.textContent = temp;

  // feels like: open-meteo doesn't give feels like directly.
  // We'll approximate: use current temperature again
  feelsLike.textContent = (cur.temperature !== undefined) ? `${Math.round(cur.temperature)}°` : '—';

  // wind
  windEl.textContent = cur.windspeed ? `${Math.round(cur.windspeed)} м/с` : '—';

  // humidity: take nearest hourly value to current time
  let humidity = '—';
  if(data.hourly && data.hourly.relativehumidity_2m && data.hourly.time){
    const nowISO = data.current_weather.time; // open-meteo uses matching timezone
    const idx = data.hourly.time.indexOf(nowISO);
    if(idx >= 0){
      humidity = data.hourly.relativehumidity_2m[idx] + '%';
    } else {
      // fallback: use first value
      const h = data.hourly.relativehumidity_2m[0];
      if(h !== undefined) humidity = h + '%';
    }
  }
  humidityEl.textContent = humidity;

  // sunrise / sunset: daily arrays - find today index 0 (open-meteo returns daily aligned)
  if(data.daily && data.daily.sunrise && data.daily.sunrise.length){
    sunriseEl.textContent = formatTime(data.daily.sunrise[0]);
  }
  if(data.daily && data.daily.sunset && data.daily.sunset.length){
    sunsetEl.textContent = formatTime(data.daily.sunset[0]);
  }

  // big icon: use current weather code (fallback to daily[0].weathercode)
  let wcode = cur.weathercode;
  if(wcode === undefined && data.daily && data.daily.weathercode && data.daily.weathercode.length) wcode = data.daily.weathercode[0];
  const iconName = WEATHER_CODE_TO_ICON[wcode] || 'weather.svg';
  bigIcon.innerHTML = `<img src="${iconPath(iconName)}" alt="icon" />`;

  // small description
  smallDesc.textContent = weatherCodeToDesc(wcode);

  // forecast (today + 2 next days at least)
  renderForecast(data.daily);

  // cache latest
  setCache(data._meta.lat, data._meta.lon, data);
}

function renderForecast(daily){
  if(!daily) { forecastList.innerHTML = '<div>Нет данных</div>'; return; }
  // daily fields: time[], temperature_2m_max[], temperature_2m_min[], weathercode[]
  const days = Math.min(daily.time.length, 7);
  forecastList.innerHTML = '';
  for(let i = 0; i < days; i++){
    const dayLabel = i===0 ? 'Сегодня' : (new Date(daily.time[i]).toLocaleDateString('ru-RU', { weekday: 'short' }));
    const wcode = daily.weathercode[i];
    const icon = WEATHER_CODE_TO_ICON[wcode] || 'weather.svg';
    const tmin = Math.round(daily.temperature_2m_min[i]);
    const tmax = Math.round(daily.temperature_2m_max[i]);
    const item = document.createElement('div');
    item.className = 'forecast-item';
    item.innerHTML = `<div class="day">${dayLabel}</div>
      <img src="${iconPath(icon)}" alt="ic"/>
      <div class="t">${tmin}° / ${tmax}°</div>`;
    forecastList.appendChild(item);
  }
}

function formatTime(iso){
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  } catch(e){
    return iso;
  }
}

function weatherCodeToDesc(code){
  // краткие описания
  const map = {
    0: 'Ясно',
    1: 'Малооблачно',
    2: 'Облачно',
    3: 'Пасмурно',
    45: 'Туман',
    48: 'Туман',
    51: 'Морось',
    53: 'Лёгкий дождь',
    55: 'Дождь',
    56: 'Морось (с ледяными кристаллами)',
    57: 'Морось',
    61: 'Дождь',
    63: 'Дождь',
    65: 'Сильный дождь',
    71: 'Снежно',
    73: 'Снег',
    75: 'Сильный снег',
    80: 'Ливень',
    81: 'Ливень',
    82: 'Сильный ливень',
    95: 'Гроза',
    96: 'Гроза',
    99: 'Гроза'
  };
  return map[code] || '—';
}

// On load, hydrate and init
init();
