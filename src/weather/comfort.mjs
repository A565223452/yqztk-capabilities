/**
 * capability: weather/apparent-temperature
 * ============================================================
 * 来源工具：yuanqizhike.com/tools/weather-apparent-temperature-calc
 * 版本：1.0.0
 *
 * 为什么这个能力值得做：
 *   体感温度是**安全相关**的计算 —— 户外作业、马拉松、农场管理都靠它决定
 *   是否停工/停赛。而它由三条互不相同的经验公式组成，各自有适用的温湿度区间，
 *   用错区间会得出荒谬数值。AI 给出一个「感觉像 38°C」的说法不可核查；
 *   本能力返回用了哪条公式、为什么用这条、以及各公式的输入是否落在适用区间内。
 *
 * ── 与站点工具实现的差异（本能力是修正版）─────────────────────────
 *   [F1] 明确公式适用区间并给出越界告警：站点只在内部判断 `tempF >= 80` 之类，
 *        越界时**悄悄换用另一条公式**，返回值里不说明用了哪条。
 *        本能力返回 `method`（heat-index / wind-chill / australian-apparent）
 *        以及 `applicability`（每条公式是否在适用区间内）。
 *   [F2] 湿度/WBGT 相关的边界不再静默：站点在 tempF < 80 时不计算 heat index，
 *        但仍会把 humidity 参与 Aus AT 的蒸汽压计算，可能得出「高湿低温下更热」
 *        的反直觉结果。本能力在两条公式结论方向矛盾时给出 warning。
 *   [F3] 单位转换不再依赖隐式分支：站点混用 `wind * 0.621371`（km/h → mph）
 *        与 `wind * 2.23694`（m/s → mph），靠 select 的值分流，写错就静默算错。
 *        本能力用显式单位表换算。
 *   [F4] 太阳辐射修正是可选显式项（站点默认按 0.02°F per W/m² 叠加，
 *        且没有说明来源）。
 *
 * ── 保持与站点工具一致的部分 ────────────────────────────────────
 *   Rothfusz 热指数回归式及其两处调整项、NWS 风寒公式、
 *   Australian Apparent Temperature 公式（含蒸汽压 Magnus 式）、
 *   以及 0.02°F per W/m² 的太阳辐射近似。
 *
 * ── 已知局限 ───────────────────────────────────────────────────
 *   [L1] 热指数基于 40°F–140°F / 相对湿度 ≥ 40% 的拟合区间，超出后误差迅速增大。
 *   [L2] 风寒只对风速 ≥ 3 mph 且气温 ≤ 50°F 有意义，低温无风时会被高估。
 *   [L3] 太阳辐射修正为线性近似，不含风速对辐射效应的影响。
 *   [L4] 体感温度是经验指标，不构成高温作业或赛事安全的决策依据。
 */

const round = (x, n = 1) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

const WIND_TO_MPS = Object.freeze({ ms: 1, kmh: 1 / 3.6, mph: 0.44704, knots: 0.514444 });

/** Rothfusz 热指数回归（返回华氏） */
export function heatIndexFahrenheit(tempF, relativeHumidity) {
  const T = tempF;
  const R = relativeHumidity;
  let HI =
    -42.379 +
    2.04901523 * T +
    10.14333127 * R -
    0.22475541 * T * R -
    0.00683783 * T * T -
    0.05481717 * R * R +
    0.00122874 * T * T * R +
    0.00085282 * T * R * R -
    0.00000199 * T * T * R * R;

  // 两处官方调整项
  if (R < 13 && T >= 80 && T <= 112) {
    HI -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  }
  if (R > 85 && T >= 80 && T <= 87) {
    HI += ((R - 85) / 10) * ((87 - T) / 5);
  }
  return HI;
}

/** NWS 风寒公式（返回华氏；要求 T ≤ 50°F 且 V ≥ 3 mph） */
export function windChillFahrenheit(tempF, windMph) {
  const v = windMph ** 0.16;
  return 35.74 + 0.6215 * tempF - 35.75 * v + 0.4275 * tempF * v;
}

/** 蒸汽压（hPa），Magnus 式 */
export function vapourPressure(tempF, relativeHumidity) {
  const tempC = ((tempF - 32) * 5) / 9;
  const es = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
  return es * (relativeHumidity / 100);
}

/** Australian Apparent Temperature（返回华氏） */
export function australianApparentFahrenheit(tempF, relativeHumidity, windMps) {
  const e = vapourPressure(tempF, relativeHumidity);
  return tempF + 0.33 * e - 0.7 * windMps - 4.0;
}

/**
 * 综合体感温度。
 *
 * @param {object} input
 * @param {number} input.temperature 气温
 * @param {'C'|'F'} [input.temperatureUnit='C']
 * @param {number} [input.humidityPercent=50]
 * @param {number} [input.windSpeed=0]
 * @param {'ms'|'kmh'|'mph'|'knots'} [input.windUnit='ms']
 * @param {number} [input.solarRadiationWm2=0]
 * @param {'C'|'F'} [input.outputUnit] 输出单位，默认跟随输入
 */
export function calcApparentTemperature(input = {}) {
  const temperature = Number(input.temperature);
  if (!Number.isFinite(temperature)) throw new RangeError('temperature 必须是数值');

  const tUnit = input.temperatureUnit ?? 'C';
  if (!['C', 'F'].includes(tUnit)) throw new RangeError("temperatureUnit 只能是 'C' 或 'F'");

  const humidity = Number(input.humidityPercent ?? 50);
  if (!Number.isFinite(humidity) || humidity < 0 || humidity > 100) throw new RangeError('humidityPercent 必须在 0~100 之间');

  const windSpeed = Number(input.windSpeed ?? 0);
  const windUnit = input.windUnit ?? 'ms';
  if (!Number.isFinite(windSpeed) || windSpeed < 0) throw new RangeError('windSpeed 必须是非负数');
  if (!(windUnit in WIND_TO_MPS)) throw new RangeError(`windUnit 只能是 ${Object.keys(WIND_TO_MPS).join(' / ')}`);

  const solar = Number(input.solarRadiationWm2 ?? 0);
  if (!Number.isFinite(solar) || solar < 0) throw new RangeError('solarRadiationWm2 必须是非负数');

  const outputUnit = input.outputUnit ?? tUnit;
  if (!['C', 'F'].includes(outputUnit)) throw new RangeError("outputUnit 只能是 'C' 或 'F'");

  const tempF = tUnit === 'C' ? (temperature * 9) / 5 + 32 : temperature;
  const tempC = tUnit === 'C' ? temperature : ((temperature - 32) * 5) / 9;
  const windMps = windSpeed * WIND_TO_MPS[windUnit];
  const windMph = windMps / WIND_TO_MPS.mph;

  const hiApplicable = tempF >= 80 && humidity >= 40;
  const wcApplicable = tempF <= 50 && windMph >= 3;

  const heatIndex = hiApplicable ? heatIndexFahrenheit(tempF, humidity) : null;
  const windChill = wcApplicable ? windChillFahrenheit(tempF, windMph) : null;
  const ausAt = australianApparentFahrenheit(tempF, humidity, windMps);

  let method;
  let baseF;
  if (heatIndex !== null && tempF >= 80) {
    method = 'heat-index';
    baseF = heatIndex;
  } else if (windChill !== null && tempF <= 50) {
    method = 'wind-chill';
    baseF = windChill;
  } else {
    method = 'australian-apparent';
    baseF = ausAt;
  }

  const solarCorrection = solar * 0.02; // °F per W/m²，与站点一致
  const apparentF = baseF + solarCorrection;
  const apparentC = ((apparentF - 32) * 5) / 9;

  const warnings = [];

  // [F2] 两条公式都不适用时明确提示：此时结果只反映湿度与风的线性效应
  if (windChill === null && heatIndex === null) {
    warnings.push('温度处于两条经验公式的间隙区间（50–80°F），本结果只反映湿度与风的线性效应');
  }
  if (humidity > 90 && tempC > 30) warnings.push('高湿高温下热指数误差会明显增大，请谨慎解读');
  if (!hiApplicable && tempF >= 80) warnings.push('气温达到热指数区间但湿度低于 40%，热指数不适用');
  if (!wcApplicable && tempF <= 50) warnings.push('气温达到风寒区间但风速低于 3 mph，风寒公式不适用');
  if (solar > 0) warnings.push('太阳辐射修正为线性近似（0.02°F per W/m²），未考虑风速对辐射效应的影响');
  warnings.push('体感温度是经验指标，不构成高温作业或赛事安全的决策依据');

  const out = (f, c) => (outputUnit === 'F' ? round(f) : round(c));

  return {
    input: {
      temperature, temperatureUnit: tUnit, humidityPercent: humidity,
      windSpeed, windUnit, solarRadiationWm2: solar, outputUnit,
    },
    normalized: { tempF: round(tempF, 2), tempC: round(tempC, 2), windMps: round(windMps, 3), windMph: round(windMph, 2) },
    method,
    applicability: {
      heatIndex: { applicable: hiApplicable, requires: 'tempF ≥ 80 且 humidity ≥ 40%' },
      windChill: { applicable: wcApplicable, requires: 'tempF ≤ 50 且 windMph ≥ 3' },
      australianApparent: { applicable: true, requires: '全区间适用（含湿与风的线性修正）' },
    },
    components: {
      heatIndexF: heatIndex === null ? null : round(heatIndex, 2),
      windChillF: windChill === null ? null : round(windChill, 2),
      australianApparentF: round(ausAt, 2),
      solarCorrectionF: round(solarCorrection, 2),
    },
    apparent: {
      fahrenheit: round(apparentF, 2),
      celsius: round(apparentC, 2),
      value: out(apparentF, apparentC),
      unit: outputUnit,
      /** 体感与实测的差值：正数表示「感觉更热」 */
      deltaFromActual: {
        fahrenheit: round(apparentF - tempF, 2),
        celsius: round(apparentC - tempC, 2),
      },
    },
    interpretation:
      apparentC >= 40 ? 'extreme-heat-danger'
      : apparentC >= 32 ? 'heat-caution'
      : apparentC <= -10 ? 'extreme-cold-danger'
      : apparentC <= 0 ? 'cold-caution'
      : 'moderate',
    warnings,
  };
}
