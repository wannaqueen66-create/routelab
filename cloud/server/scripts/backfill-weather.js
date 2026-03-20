#!/usr/bin/env node
/**
 * One-time script: backfill weather data for existing routes that have GPS points but no weather.
 * Usage: docker exec cloud-api-1 node scripts/backfill-weather.js
 */

const { pool } = require('../src/db/index');
const {
    fetchCurrentWeather,
    fetchAirQuality,
    describeAqi,
    buildExerciseSuggestion,
} = require('../src/services/weatherService');

const BATCH_SIZE = 5;
const DELAY_MS = 2000; // Be gentle on QWeather API

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    // Points are in route_points table, not routes table
    const { rows } = await pool.query(`
        SELECT r.id, rp.latitude, rp.longitude
        FROM routes r
        INNER JOIN route_points rp ON rp.route_id = r.id AND rp.seq = 0
        WHERE r.weather IS NULL
        ORDER BY r.created_at DESC
    `);

    console.log(`Found ${rows.length} routes without weather data.`);
    if (!rows.length) {
        process.exit(0);
    }

    let success = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
        const route = rows[i];
        if (!route.latitude || !route.longitude) {
            console.log(`  [${i + 1}/${rows.length}] ${route.id} — no valid point, skip`);
            failed++;
            continue;
        }

        try {
            const [weather, air] = await Promise.all([
                fetchCurrentWeather(route.latitude, route.longitude).catch(() => null),
                fetchAirQuality(route.latitude, route.longitude).catch(() => null),
            ]);

            if (!weather) {
                console.log(`  [${i + 1}/${rows.length}] ${route.id} — weather API failed, skip`);
                failed++;
                continue;
            }

            const aqi = air ? air.aqi : null;
            const airLevel = air ? describeAqi(air.aqi) : null;
            const suggestion = buildExerciseSuggestion({
                temperature: weather.temperature,
                aqi,
                weatherCode: weather.weatherCode,
                windSpeed: weather.windSpeed,
                humidity: weather.humidity,
            });

            const snapshot = {
                temperature: weather.temperature,
                apparentTemperature: weather.apparentTemperature,
                weatherText: weather.weatherText,
                humidity: weather.humidity,
                windSpeed: weather.windSpeed,
                weatherCode: weather.weatherCode,
                aqi,
                airLevel: airLevel ? airLevel.level : null,
                suggestion,
                source: weather.source || 'backfill',
                backfilledAt: new Date().toISOString(),
            };

            await pool.query(
                `UPDATE routes SET weather = $1, updated_at = NOW() WHERE id = $2 AND weather IS NULL`,
                [JSON.stringify(snapshot), route.id]
            );

            console.log(`  [${i + 1}/${rows.length}] ${route.id} — ✅ ${weather.weatherText} ${weather.temperature}°`);
            success++;
        } catch (err) {
            console.log(`  [${i + 1}/${rows.length}] ${route.id} — ❌ ${err.message}`);
            failed++;
        }

        if ((i + 1) % BATCH_SIZE === 0 && i + 1 < rows.length) {
            console.log(`  ... pausing ${DELAY_MS}ms ...`);
            await sleep(DELAY_MS);
        }
    }

    console.log(`\nDone. Success: ${success}, Failed: ${failed}, Total: ${rows.length}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
