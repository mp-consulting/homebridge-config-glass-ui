/**
 * Translate OpenWeatherMap icon codes into Font Awesome icons
 * @param icon - the OpenWeatherMap icon code, e.g. `01d`
 */
export function getWeatherIconClass(icon: string | undefined): string {
  switch (icon) {
    case '01d': // clear day
      return 'far fa-sun'
    case '01n': // clear night
      return 'far fa-moon'
    case '02d': // few clouds day
      return 'fas fa-cloud-sun'
    case '02n': // few clouds night
      return 'fas fa-cloud-moon'
    case '03d': // scattered clouds day
      return 'fas fa-cloud-sun'
    case '03n': // scattered clouds night
      return 'fas fa-cloud-moon'
    case '04d': // broken clouds day
      return 'fas fa-cloud-sun'
    case '04n': // broken clouds night
      return 'fas fa-cloud-moon'
    case '09d': // shower rain day
      return 'fas fa-cloud-sun-rain'
    case '09n': // shower rain night
      return 'fas fa-cloud-moon-rain'
    case '10d': // rain day
      return 'fas fa-cloud-rain'
    case '10n': // rain night
      return 'fas fa-cloud-moon-rain'
    case '11d': // thunderstorm day
      return 'fas fa-cloud-showers-heavy'
    case '11n': // thunderstorm night
      return 'fas fa-cloud-showers-heavy'
    case '13d': // snow day
      return 'fas fa-snowflake'
    case '13n': // snow night
      return 'fas fa-snowflake'
    case '50d': // mist day
      return 'fas fa-smog'
    case '50n': // mist night
      return 'fas fa-smog'
    default:
      return 'fas fa-cloud'
  }
}
