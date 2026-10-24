package ch.duartesantos.opengym

import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Mass
import java.time.Instant
import java.time.ZoneOffset

/**
 * Java-friendly factory for NutritionRecord.
 *
 * NutritionRecord is a Kotlin data class with ~40 optional parameters; calling its constructor
 * from Java requires passing every parameter explicitly (nulls for unused ones), which is
 * verbose and fragile across SDK updates. This object wraps the construction so
 * HealthConnectPlugin.java stays readable.
 *
 * Only the fields the app actually tracks are exposed. Everything else defaults to null.
 */
object NutritionHelper {

    @JvmStatic
    fun build(
        id: String,
        version: Long,
        start: Instant,
        startOffset: ZoneOffset,
        end: Instant,
        endOffset: ZoneOffset,
        name: String?,
        caloriesKcal: Double?,
        proteinG: Double?,
        carbsG: Double?,
        fatG: Double?,
        fiberG: Double?,
        sugarG: Double?,
        saturatedFatG: Double?,
        sodiumMg: Double?
    ): NutritionRecord = NutritionRecord(
        startTime       = start,
        startZoneOffset = startOffset,
        endTime         = end,
        endZoneOffset   = endOffset,
        metadata        = Metadata.manualEntry(id, version),
        name            = name,
        energy          = caloriesKcal?.let { Energy.kilocalories(it) },
        protein         = proteinG?.let      { Mass.grams(it) },
        totalCarbohydrate = carbsG?.let      { Mass.grams(it) },
        totalFat        = fatG?.let          { Mass.grams(it) },
        dietaryFiber    = fiberG?.let        { Mass.grams(it) },
        sugar           = sugarG?.let        { Mass.grams(it) },
        saturatedFat    = saturatedFatG?.let { Mass.grams(it) },
        sodium          = sodiumMg?.let      { Mass.grams(it / 1000.0) }   // mg → g
    )
}
