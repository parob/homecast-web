// Homecast Automation Engine - Sun Calculator
// Calculates sunrise/sunset times from latitude/longitude
// Uses the standard NOAA solar position algorithm

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

/**
 * Calculate sunrise and sunset times for a given date and location.
 * Based on NOAA's solar calculator algorithm.
 */
export function calculateSunTimes(date: Date, latitude: number, longitude: number): SunTimes {
  const jd = julianDay(date);
  const jc = julianCentury(jd);

  const sunriseMins = calcSunriseSet(true, jc, latitude, longitude);
  const sunsetMins = calcSunriseSet(false, jc, latitude, longitude);

  const sunrise = minutesToDate(date, sunriseMins);
  const sunset = minutesToDate(date, sunsetMins);

  return { sunrise, sunset };
}

/**
 * Get the next occurrence of sunrise or sunset from now.
 * If today's event has passed, returns tomorrow's.
 */
export function getNextSunEvent(
  event: 'sunrise' | 'sunset',
  latitude: number,
  longitude: number,
  offsetMs: number = 0,
): Date {
  const now = new Date();
  const today = calculateSunTimes(now, latitude, longitude);
  const target = new Date((event === 'sunrise' ? today.sunrise : today.sunset).getTime() + offsetMs);

  if (target.getTime() > now.getTime()) {
    return target;
  }

  // Already passed today, get tomorrow's
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowTimes = calculateSunTimes(tomorrow, latitude, longitude);
  return new Date(
    (event === 'sunrise' ? tomorrowTimes.sunrise : tomorrowTimes.sunset).getTime() + offsetMs,
  );
}

/**
 * Check if the sun is currently above the horizon.
 */
export function isSunUp(latitude: number, longitude: number): boolean {
  const now = new Date();
  const times = calculateSunTimes(now, latitude, longitude);
  return now >= times.sunrise && now <= times.sunset;
}

// ============================================================
// NOAA Solar Position Algorithm
// ============================================================

function julianDay(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const h = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  let jy = y;
  let jm = m;
  if (m <= 2) { jy--; jm += 12; }

  const A = Math.floor(jy / 100);
  const B = 2 - A + Math.floor(A / 4);

  return Math.floor(365.25 * (jy + 4716)) + Math.floor(30.6001 * (jm + 1)) + d + h / 24 + B - 1524.5;
}

function julianCentury(jd: number): number {
  return (jd - 2451545.0) / 36525.0;
}

function geomMeanLongSun(t: number): number {
  let L0 = 280.46646 + t * (36000.76983 + 0.0003032 * t);
  while (L0 > 360) L0 -= 360;
  while (L0 < 0) L0 += 360;
  return L0;
}

function geomMeanAnomalySun(t: number): number {
  return 357.52911 + t * (35999.05029 - 0.0001537 * t);
}

function eccentricityEarthOrbit(t: number): number {
  return 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
}

function sunEqOfCenter(t: number): number {
  const m = geomMeanAnomalySun(t) * DEG_TO_RAD;
  return Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m) * 0.000289;
}

function sunTrueLong(t: number): number {
  return geomMeanLongSun(t) + sunEqOfCenter(t);
}

function sunApparentLong(t: number): number {
  const omega = 125.04 - 1934.136 * t;
  return sunTrueLong(t) - 0.00569 - 0.00478 * Math.sin(omega * DEG_TO_RAD);
}

function meanObliquityOfEcliptic(t: number): number {
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  return 23 + (26 + seconds / 60) / 60;
}

function obliquityCorrection(t: number): number {
  const omega = 125.04 - 1934.136 * t;
  return meanObliquityOfEcliptic(t) + 0.00256 * Math.cos(omega * DEG_TO_RAD);
}

function sunDeclination(t: number): number {
  const e = obliquityCorrection(t) * DEG_TO_RAD;
  const lambda = sunApparentLong(t) * DEG_TO_RAD;
  return Math.asin(Math.sin(e) * Math.sin(lambda)) * RAD_TO_DEG;
}

function equationOfTime(t: number): number {
  const epsilon = obliquityCorrection(t) * DEG_TO_RAD;
  const l0 = geomMeanLongSun(t) * DEG_TO_RAD;
  const e = eccentricityEarthOrbit(t);
  const m = geomMeanAnomalySun(t) * DEG_TO_RAD;

  let y = Math.tan(epsilon / 2);
  y *= y;

  const sin2l0 = Math.sin(2 * l0);
  const sin4l0 = Math.sin(4 * l0);
  const cos2l0 = Math.cos(2 * l0);
  const sinm = Math.sin(m);
  const sin2m = Math.sin(2 * m);

  const eot = y * sin2l0 - 2 * e * sinm + 4 * e * y * sinm * cos2l0
    - 0.5 * y * y * sin4l0 - 1.25 * e * e * sin2m;

  return eot * 4 * RAD_TO_DEG; // in minutes
}

function hourAngleSunrise(lat: number, solarDec: number): number {
  const latRad = lat * DEG_TO_RAD;
  const decRad = solarDec * DEG_TO_RAD;

  const HA = Math.acos(
    Math.cos(90.833 * DEG_TO_RAD) / (Math.cos(latRad) * Math.cos(decRad))
    - Math.tan(latRad) * Math.tan(decRad),
  );

  return HA * RAD_TO_DEG; // in degrees
}

function calcSunriseSet(isRise: boolean, jc: number, latitude: number, longitude: number): number {
  const eqTime = equationOfTime(jc);
  const solarDec = sunDeclination(jc);
  const ha = hourAngleSunrise(latitude, solarDec);

  const haMinutes = isRise ? -ha : ha;
  // Time in minutes from midnight UTC
  const timeUTC = 720 - 4 * (longitude + haMinutes) - eqTime;

  return timeUTC;
}

function minutesToDate(date: Date, minutesUTC: number): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCMinutes(Math.round(minutesUTC));
  return result;
}
