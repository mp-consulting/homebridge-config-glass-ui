/**
 * The animated `coolingGradient` / `heatingGradient` the climate tiles paint
 * their status window with (`fill="url(#coolingGradient)"`). Each tile carries
 * its own copy, as the Angular templates did. The humidifier uses the same
 * two under its own ids.
 */
export function ClimateGradientDefs({ coolId = 'coolingGradient', heatId = 'heatingGradient' }: { coolId?: string, heatId?: string }) {
  return (
    <defs>
      <linearGradient id={coolId} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor="#1e8bbd">
          <animate attributeName="stop-color" values="#1e8bbd;#66d6d6;#1e8bbd" dur="5s" repeatCount="indefinite" />
        </stop>
        <stop offset="50%" stopColor="#66d6d6">
          <animate attributeName="stop-color" values="#66d6d6;#1e8bbd;#66d6d6" dur="5s" repeatCount="indefinite" />
        </stop>
        <stop offset="100%" stopColor="#1e8bbd">
          <animate attributeName="stop-color" values="#1e8bbd;#66d6d6;#1e8bbd" dur="5s" repeatCount="indefinite" />
        </stop>
      </linearGradient>
      <linearGradient id={heatId} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor="#cc5e00">
          <animate attributeName="stop-color" values="#cc5e00;#e69533;#cc5e00;#e69533" dur="5s" repeatCount="indefinite" />
        </stop>
        <stop offset="50%" stopColor="#e69533">
          <animate attributeName="stop-color" values="#e69533;#cc5e00;#e69533;#cc5e00" dur="5s" repeatCount="indefinite" />
        </stop>
        <stop offset="100%" stopColor="#cc5e00">
          <animate attributeName="stop-color" values="#cc5e00;#e69533;#cc5e00;#e69533" dur="5s" repeatCount="indefinite" />
        </stop>
      </linearGradient>
    </defs>
  )
}
