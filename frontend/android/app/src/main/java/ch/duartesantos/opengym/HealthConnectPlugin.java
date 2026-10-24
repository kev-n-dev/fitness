package ch.duartesantos.opengym;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.contract.ActivityResultContract;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord;
import androidx.health.connect.client.records.DistanceRecord;
import androidx.health.connect.client.records.ElectrocardiogramRecord;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord;
import androidx.health.connect.client.records.HydrationRecord;
import androidx.health.connect.client.records.IrregularRhythmNotificationRecord;
import androidx.health.connect.client.records.MoodObservationRecord;
import androidx.health.connect.client.records.NutritionRecord;
import androidx.health.connect.client.records.OxygenSaturationRecord;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.RespiratoryRateRecord;
import androidx.health.connect.client.records.RestingHeartRateRecord;
import androidx.health.connect.client.records.SleepSessionRecord;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.records.Vo2MaxRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;
import androidx.health.connect.client.units.Mass;
import androidx.health.connect.client.units.Volume;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlinx.coroutines.BuildersKt;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reads and writes health data to/from Health Connect (#200).
 *
 * Write side: finished workouts, weigh-ins, meals (nutrition + hydration).
 * Read side: steps, distance, calories, heart rate, exercise sessions from other apps,
 *            plus extended clinical data — resting HR, HRV, SpO2, respiratory rate,
 *            VO2 Max, sleep sessions, ECG, irregular rhythm alerts, mood, and today's
 *            nutrition/hydration from other apps.
 *
 * All operations are off until the user turns them on in Settings. No permission is
 * requested before that.
 *
 * Usage from JS (lib/health-sync.js and lib/health-read.js):
 *   const HC = registerPlugin('HealthConnect');
 *
 *   // Write
 *   await HC.status()
 *   await HC.requestPermissions()
 *   await HC.write({ sessions, weights })
 *   await HC.remove({ sessions: [ids], weights: [ids] })
 *   await HC.writeNutrition({ nutrition, hydration })
 *   await HC.removeNutrition({ nutrition: [ids], hydration: [ids] })
 *
 *   // Read
 *   await HC.statusRead()
 *   await HC.requestReadPermissions()
 *   await HC.readDaily({ startMs, endMs })
 *   await HC.readExtendedVitals({ startMs, endMs })
 *   await HC.readSleep({ startMs, endMs })
 *   await HC.readNutrition({ startMs, endMs })
 *   await HC.readExerciseSessions({ startMs, endMs })
 *   await HC.openSettings()
 */
@CapacitorPlugin(name = "HealthConnect")
public class HealthConnectPlugin extends Plugin {

    private static final String PROVIDER = "com.google.android.apps.healthdata";

    // ── Write permissions ─────────────────────────────────────────────────────
    private static final String WRITE_EXERCISE   = "android.permission.health.WRITE_EXERCISE";
    private static final String WRITE_WEIGHT     = "android.permission.health.WRITE_WEIGHT";
    private static final String WRITE_NUTRITION  = "android.permission.health.WRITE_NUTRITION";
    private static final String WRITE_HYDRATION  = "android.permission.health.WRITE_HYDRATION";

    // ── Basic read permissions ────────────────────────────────────────────────
    private static final String READ_STEPS    = "android.permission.health.READ_STEPS";
    private static final String READ_DISTANCE = "android.permission.health.READ_DISTANCE";
    private static final String READ_CALORIES = "android.permission.health.READ_ACTIVE_CALORIES_BURNED";
    private static final String READ_HR       = "android.permission.health.READ_HEART_RATE";
    private static final String READ_EXERCISE = "android.permission.health.READ_EXERCISE";

    // ── Extended clinical read permissions ────────────────────────────────────
    private static final String READ_RESTING_HR      = "android.permission.health.READ_RESTING_HEART_RATE";
    private static final String READ_HRV             = "android.permission.health.READ_HEART_RATE_VARIABILITY";
    private static final String READ_RESP_RATE       = "android.permission.health.READ_RESPIRATORY_RATE";
    private static final String READ_SPO2            = "android.permission.health.READ_OXYGEN_SATURATION";
    private static final String READ_ECG             = "android.permission.health.READ_ELECTROCARDIOGRAM";
    private static final String READ_SLEEP           = "android.permission.health.READ_SLEEP";
    private static final String READ_VO2             = "android.permission.health.READ_VO2_MAX";
    private static final String READ_IRREGULAR       = "android.permission.health.READ_IRREGULAR_HEART_RHYTHM_STATUS";
    private static final String READ_MOOD            = "android.permission.health.READ_MINDFULNESS";

    // ── Nutrition / hydration read permissions ────────────────────────────────
    private static final String READ_NUTRITION_PERM  = "android.permission.health.READ_NUTRITION";
    private static final String READ_HYDRATION_PERM  = "android.permission.health.READ_HYDRATION";

    private static final int CHUNK = 500;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    private static Set<String> permissions() {
        Set<String> p = new HashSet<>();
        p.add(WRITE_EXERCISE);
        p.add(WRITE_WEIGHT);
        p.add(WRITE_NUTRITION);
        p.add(WRITE_HYDRATION);
        return p;
    }

    private static Set<String> readPermissions() {
        Set<String> p = new HashSet<>();
        // Basic
        p.add(READ_STEPS);
        p.add(READ_DISTANCE);
        p.add(READ_CALORIES);
        p.add(READ_HR);
        p.add(READ_EXERCISE);
        // Extended clinical
        p.add(READ_RESTING_HR);
        p.add(READ_HRV);
        p.add(READ_RESP_RATE);
        p.add(READ_SPO2);
        p.add(READ_ECG);
        p.add(READ_SLEEP);
        p.add(READ_VO2);
        p.add(READ_IRREGULAR);
        p.add(READ_MOOD);
        // Nutrition
        p.add(READ_NUTRITION_PERM);
        p.add(READ_HYDRATION_PERM);
        return p;
    }

    private String sdkStatus() {
        if (!supported()) return "unsupported";
        int s = HealthConnectClient.Companion.getSdkStatus(getContext(), PROVIDER);
        if (s == HealthConnectClient.SDK_AVAILABLE) return "available";
        if (s == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update";
        return Build.VERSION.SDK_INT >= 34 ? "unsupported" : "missing";
    }

    private HealthConnectClient client() {
        return HealthConnectClient.Companion.getOrCreate(getContext(), PROVIDER);
    }

    @SuppressWarnings("unchecked")
    private Set<String> granted() throws InterruptedException {
        PermissionController pc = client().getPermissionController();
        return (Set<String>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> pc.getGrantedPermissions(cont));
    }

    // ── Status & settings ─────────────────────────────────────────────────────

    @PluginMethod
    public void status(PluginCall call) {
        String status = sdkStatus();
        if (!"available".equals(status)) {
            JSObject r = new JSObject(); r.put("status", status); r.put("granted", false); call.resolve(r); return;
        }
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("status", status);
                r.put("granted", granted().containsAll(permissions()));
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), permissions());
        startActivityForResult(call, intent, "permissionsResult");
    }

    @ActivityCallback
    private void permissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Set<String> got = contract.parseResult(result.getResultCode(), result.getData());
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("granted", (got != null && got.containsAll(permissions())) || granted().containsAll(permissions()));
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String status = sdkStatus();
        if ("unsupported".equals(status)) { call.reject("Health Connect is not available", "unavailable"); return; }
        try {
            Intent intent = "available".equals(status)
                    ? HealthConnectClient.Companion.getHealthConnectManageDataIntent(getContext(), PROVIDER)
                    : new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + PROVIDER + "&url=healthconnect%3A%2F%2Fonboarding"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
    }

    // ── Write: workouts + body weight ─────────────────────────────────────────

    @PluginMethod
    public void write(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights  = call.getArray("weights",  new JSArray());
        worker.execute(() -> {
            try {
                long version = System.currentTimeMillis();
                List<Record> records = new ArrayList<>();
                for (int i = 0; i < sessions.length(); i++) records.add(session(sessions.getJSONObject(i), version));
                for (int i = 0; i < weights.length();  i++) records.add(weight(weights.getJSONObject(i), version));
                for (int from = 0; from < records.size(); from += CHUNK) {
                    List<Record> part = records.subList(from, Math.min(records.size(), from + CHUNK));
                    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().insertRecords(part, cont));
                }
                call.resolve();
            } catch (SecurityException e) { call.reject(e.getMessage(), "permission");
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights  = call.getArray("weights",  new JSArray());
        worker.execute(() -> {
            try {
                delete(ExerciseSessionRecord.class, ids(sessions));
                delete(WeightRecord.class, ids(weights));
                call.resolve();
            } catch (SecurityException e) { call.reject(e.getMessage(), "permission");
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    // ── Write: nutrition + hydration ──────────────────────────────────────────

    /**
     * Call: HC.writeNutrition({ nutrition: [...], hydration: [...] })
     * Each nutrition entry: { id, start, end, name?, calories?, protein?, carbs?, fat?,
     *                          fiber?, sugar?, saturatedFat?, sodium? }
     * Each hydration entry: { id, start, end, volumeMl }
     */
    @PluginMethod
    public void writeNutrition(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        JSArray nutrition = call.getArray("nutrition", new JSArray());
        JSArray hydration = call.getArray("hydration", new JSArray());
        worker.execute(() -> {
            try {
                long version = System.currentTimeMillis();
                List<Record> records = new ArrayList<>();
                for (int i = 0; i < nutrition.length(); i++) records.add(nutritionRecord(nutrition.getJSONObject(i), version));
                for (int i = 0; i < hydration.length(); i++) records.add(hydrationRecord(hydration.getJSONObject(i), version));
                for (int from = 0; from < records.size(); from += CHUNK) {
                    List<Record> part = records.subList(from, Math.min(records.size(), from + CHUNK));
                    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().insertRecords(part, cont));
                }
                call.resolve();
            } catch (SecurityException e) { call.reject(e.getMessage(), "permission");
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    /**
     * Call: HC.removeNutrition({ nutrition: [ids], hydration: [ids] })
     */
    @PluginMethod
    public void removeNutrition(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        JSArray nutrition = call.getArray("nutrition", new JSArray());
        JSArray hydration = call.getArray("hydration", new JSArray());
        worker.execute(() -> {
            try {
                delete(NutritionRecord.class, ids(nutrition));
                delete(HydrationRecord.class, ids(hydration));
                call.resolve();
            } catch (SecurityException e) { call.reject(e.getMessage(), "permission");
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    // ── Read permissions ──────────────────────────────────────────────────────

    @PluginMethod
    public void statusRead(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            JSObject r = new JSObject(); r.put("granted", false); call.resolve(r); return;
        }
        worker.execute(() -> {
            try {
                // Granted if at least the basic five read perms are held.
                Set<String> basic = new HashSet<>();
                basic.add(READ_STEPS); basic.add(READ_DISTANCE);
                basic.add(READ_CALORIES); basic.add(READ_HR); basic.add(READ_EXERCISE);
                Set<String> g = granted();
                JSObject r = new JSObject();
                r.put("granted", g.containsAll(basic));
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    /** Requests all read permissions (basic + extended clinical + nutrition). */
    @PluginMethod
    public void requestReadPermissions(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), readPermissions());
        startActivityForResult(call, intent, "readPermissionsResult");
    }

    @ActivityCallback
    private void readPermissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Set<String> got = contract.parseResult(result.getResultCode(), result.getData());
        worker.execute(() -> {
            try {
                Set<String> basic = new HashSet<>();
                basic.add(READ_STEPS); basic.add(READ_DISTANCE);
                basic.add(READ_CALORIES); basic.add(READ_HR); basic.add(READ_EXERCISE);
                boolean g = (got != null && got.containsAll(basic)) || granted().containsAll(basic);
                JSObject r = new JSObject(); r.put("granted", g); call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    // ── Read: basic daily vitals ──────────────────────────────────────────────

    /**
     * Call: HC.readDaily({ startMs, endMs })
     * Returns: { steps, distanceM, calories, avgBpm, minBpm, maxBpm }
     */
    @PluginMethod
    public void readDaily(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        long startMs = call.getLong("startMs", todayStartMs());
        long endMs   = call.getLong("endMs",   System.currentTimeMillis());
        worker.execute(() -> {
            try {
                Instant start = Instant.ofEpochMilli(startMs);
                Instant end   = Instant.ofEpochMilli(endMs);
                TimeRangeFilter range = TimeRangeFilter.Companion.between(start, end);
                Set<String> g = granted();

                long   steps    = g.contains(READ_STEPS)    ? sumSteps(range)    : 0;
                double distM    = g.contains(READ_DISTANCE) ? sumDistance(range) : 0;
                double calories = g.contains(READ_CALORIES) ? sumCalories(range) : 0;
                int[]  hr       = g.contains(READ_HR)       ? avgHr(range) : new int[]{0,0,0};

                JSObject r = new JSObject();
                r.put("steps",     steps);
                r.put("distanceM", distM);
                r.put("calories",  calories);
                r.put("avgBpm",    hr[0]);
                r.put("minBpm",    hr[1]);
                r.put("maxBpm",    hr[2]);
                call.resolve(r);
            } catch (SecurityException e) { call.reject(e.getMessage(), "permission");
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    // ── Read: extended clinical vitals ────────────────────────────────────────

    /**
     * Call: HC.readExtendedVitals({ startMs, endMs })
     * Returns: { restingBpm, hrvMs, spo2, respiratoryRate, vo2Max,
     *            irregularRhythmAlert, mood }
     *
     * vo2Max looks back 90 days (it changes slowly). All fields default to 0 / false
     * when no data is available or the permission was not granted.
     */
    @PluginMethod
    public void readExtendedVitals(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        long startMs = call.getLong("startMs", todayStartMs());
        long endMs   = call.getLong("endMs",   System.currentTimeMillis());
        worker.execute(() -> {
            try {
                Instant start = Instant.ofEpochMilli(startMs);
                Instant end   = Instant.ofEpochMilli(endMs);
                TimeRangeFilter range    = TimeRangeFilter.Companion.between(start, end);
                // VO2Max changes slowly; look back 90 days for a recent measurement.
                TimeRangeFilter vo2Range = TimeRangeFilter.Companion.between(
                        Instant.ofEpochMilli(endMs - 90L * 86400000L), end);

                Set<String> g = granted();
                JSObject r = new JSObject();

                r.put("restingBpm",          g.contains(READ_RESTING_HR) ? latestRestingHR(range) : 0);
                r.put("hrvMs",               g.contains(READ_HRV)        ? avgHrv(range)          : 0);
                r.put("spo2",                g.contains(READ_SPO2)       ? avgSpo2(range)         : 0);
                r.put("respiratoryRate",     g.contains(READ_RESP_RATE)  ? avgRespiratoryRate(range) : 0);
                r.put("vo2Max",              g.contains(READ_VO2)        ? latestVo2Max(vo2Range) : 0);
                r.put("irregularRhythmAlert", g.contains(READ_IRREGULAR) && hasIrregularRhythm(range));
                r.put("mood",                g.contains(READ_MOOD)       ? latestMood(range)      : 0);

                call.resolve(r);
            } catch (SecurityException e) { call.reject(e.getMessage(), "permission");
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    // ── Read: sleep ───────────────────────────────────────────────────────────

    /**
     * Call: HC.readSleep({ startMs, endMs })
     * Returns: { sessions: [{ startMs, endMs, stages: { lightMs, deepMs, remMs, awakeMs } }] }
     *
     * Use startMs = yesterday noon to catch last night's sleep whether you woke before or
     * after midnight. Only sessions lasting at least 30 minutes are included.
     */
    @PluginMethod
    public void readSleep(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        long startMs = call.getLong("startMs", todayStartMs() - 36L * 3600000L);
        long endMs   = call.getLong("endMs",   System.currentTimeMillis());
        worker.execute(() -> {
            try {
                JSObject result = new JSObject();
                if (!granted().contains(READ_SLEEP)) {
                    result.put("sessions", new JSArray()); call.resolve(result); return;
                }
                Instant start = Instant.ofEpochMilli(startMs);
                Instant end   = Instant.ofEpochMilli(endMs);
                TimeRangeFilter range = TimeRangeFilter.Companion.between(start, end);

                ReadRecordsRequest<SleepSessionRecord> req = new ReadRecordsRequest<>(
                        JvmClassMappingKt.getKotlinClass(SleepSessionRecord.class),
                        range, Collections.emptySet(), false, 20, null);
                @SuppressWarnings("unchecked")
                ReadRecordsResponse<SleepSessionRecord> resp =
                        (ReadRecordsResponse<SleepSessionRecord>) BuildersKt.runBlocking(
                                EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().readRecords(req, cont));

                JSArray sessions = new JSArray();
                for (SleepSessionRecord s : resp.getRecords()) {
                    long dur = s.getEndTime().toEpochMilli() - s.getStartTime().toEpochMilli();
                    if (dur < 30L * 60000L) continue;    // skip < 30 min naps
                    JSObject obj = new JSObject();
                    obj.put("startMs", s.getStartTime().toEpochMilli());
                    obj.put("endMs",   s.getEndTime().toEpochMilli());
                    long light = 0, deep = 0, rem = 0, awake = 0;
                    for (SleepSessionRecord.Stage st : s.getStages()) {
                        long d = st.getEndTime().toEpochMilli() - st.getStartTime().toEpochMilli();
                        int  t = st.getStage();
                        if      (t == SleepSessionRecord.STAGE_TYPE_LIGHT) light += d;
                        else if (t == SleepSessionRecord.STAGE_TYPE_DEEP)  deep  += d;
                        else if (t == SleepSessionRecord.STAGE_TYPE_REM)   rem   += d;
                        else if (t == SleepSessionRecord.STAGE_TYPE_AWAKE) awake += d;
                    }
                    JSObject stages = new JSObject();
                    stages.put("lightMs", light);
                    stages.put("deepMs",  deep);
                    stages.put("remMs",   rem);
                    stages.put("awakeMs", awake);
                    obj.put("stages", stages);
                    sessions.put(obj);
                }
                result.put("sessions", sessions);
                call.resolve(result);
            } catch (SecurityException e) { call.reject(e.getMessage(), "permission");
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    // ── Read: nutrition + hydration from other apps ───────────────────────────

    /**
     * Call: HC.readNutrition({ startMs, endMs })
     * Returns: {
     *   nutrition: [{ calories?, protein?, carbs?, fat?, fiber?, sugar?,
     *                 saturatedFat?, sodium?, water?, name?, source }],
     *   hydration: [{ volumeMl, source }]
     * }
     *
     * openGym's own written records (clientRecordId starting with "opengym-") are
     * excluded so they don't double-count in the app's own totals.
     */
    @PluginMethod
    public void readNutrition(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        long startMs = call.getLong("startMs", todayStartMs());
        long endMs   = call.getLong("endMs",   System.currentTimeMillis());
        worker.execute(() -> {
            try {
                Instant start = Instant.ofEpochMilli(startMs);
                Instant end   = Instant.ofEpochMilli(endMs);
                TimeRangeFilter range = TimeRangeFilter.Companion.between(start, end);
                Set<String> g = granted();

                JSArray nutritionArr = new JSArray();
                if (g.contains(READ_NUTRITION_PERM)) {
                    ReadRecordsRequest<NutritionRecord> req = new ReadRecordsRequest<>(
                            JvmClassMappingKt.getKotlinClass(NutritionRecord.class),
                            range, Collections.emptySet(), false, 500, null);
                    @SuppressWarnings("unchecked")
                    ReadRecordsResponse<NutritionRecord> resp =
                            (ReadRecordsResponse<NutritionRecord>) BuildersKt.runBlocking(
                                    EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().readRecords(req, cont));
                    for (NutritionRecord n : resp.getRecords()) {
                        String clientId = n.getMetadata().getClientRecordId();
                        if (clientId != null && clientId.startsWith("opengym-")) continue;
                        JSObject obj = new JSObject();
                        if (n.getEnergy()          != null) obj.put("calories",     n.getEnergy().inKilocalories());
                        if (n.getProtein()         != null) obj.put("protein",      n.getProtein().inGrams());
                        if (n.getTotalCarbohydrate() != null) obj.put("carbs",      n.getTotalCarbohydrate().inGrams());
                        if (n.getTotalFat()        != null) obj.put("fat",          n.getTotalFat().inGrams());
                        if (n.getDietaryFiber()    != null) obj.put("fiber",        n.getDietaryFiber().inGrams());
                        if (n.getSugar()           != null) obj.put("sugar",        n.getSugar().inGrams());
                        if (n.getSaturatedFat()    != null) obj.put("saturatedFat", n.getSaturatedFat().inGrams());
                        if (n.getSodium()          != null) obj.put("sodium",       n.getSodium().inGrams() * 1000);  // g → mg
                        if (n.getName()            != null) obj.put("name",         n.getName());
                        obj.put("source", n.getMetadata().getDataOrigin().getPackageName());
                        nutritionArr.put(obj);
                    }
                }

                JSArray hydrationArr = new JSArray();
                if (g.contains(READ_HYDRATION_PERM)) {
                    ReadRecordsRequest<HydrationRecord> req = new ReadRecordsRequest<>(
                            JvmClassMappingKt.getKotlinClass(HydrationRecord.class),
                            range, Collections.emptySet(), false, 500, null);
                    @SuppressWarnings("unchecked")
                    ReadRecordsResponse<HydrationRecord> resp =
                            (ReadRecordsResponse<HydrationRecord>) BuildersKt.runBlocking(
                                    EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().readRecords(req, cont));
                    for (HydrationRecord h : resp.getRecords()) {
                        String clientId = h.getMetadata().getClientRecordId();
                        if (clientId != null && clientId.startsWith("opengym-")) continue;
                        JSObject obj = new JSObject();
                        obj.put("volumeMl", h.getVolume().inLiters() * 1000.0);
                        obj.put("source",   h.getMetadata().getDataOrigin().getPackageName());
                        hydrationArr.put(obj);
                    }
                }

                JSObject result = new JSObject();
                result.put("nutrition", nutritionArr);
                result.put("hydration", hydrationArr);
                call.resolve(result);
            } catch (SecurityException e) { call.reject(e.getMessage(), "permission");
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    // ── Read: exercise sessions from other apps ───────────────────────────────

    @PluginMethod
    public void readExerciseSessions(PluginCall call) {
        if (!"available".equals(sdkStatus())) { call.reject("Health Connect is not available", "unavailable"); return; }
        long startMs = call.getLong("startMs", System.currentTimeMillis() - 90L * 86400000L);
        long endMs   = call.getLong("endMs",   System.currentTimeMillis());
        worker.execute(() -> {
            try {
                Instant start = Instant.ofEpochMilli(startMs);
                Instant end   = Instant.ofEpochMilli(endMs);
                TimeRangeFilter range = TimeRangeFilter.Companion.between(start, end);

                ReadRecordsRequest<ExerciseSessionRecord> req = new ReadRecordsRequest<>(
                        JvmClassMappingKt.getKotlinClass(ExerciseSessionRecord.class),
                        range, Collections.emptySet(), false, 500, null);
                @SuppressWarnings("unchecked")
                ReadRecordsResponse<ExerciseSessionRecord> resp =
                        (ReadRecordsResponse<ExerciseSessionRecord>) BuildersKt.runBlocking(
                                EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().readRecords(req, cont));

                JSArray sessions = new JSArray();
                for (ExerciseSessionRecord s : resp.getRecords()) {
                    long dur = s.getEndTime().toEpochMilli() - s.getStartTime().toEpochMilli();
                    if (dur < 30000) continue;
                    String clientId = s.getMetadata().getClientRecordId();
                    if (clientId != null && clientId.startsWith("opengym-w-")) continue;
                    JSObject obj = new JSObject();
                    obj.put("id",      s.getMetadata().getId());
                    obj.put("startMs", s.getStartTime().toEpochMilli());
                    obj.put("endMs",   s.getEndTime().toEpochMilli());
                    obj.put("type",    exerciseTypeName(s.getExerciseType()));
                    obj.put("title",   s.getTitle() != null ? s.getTitle() : "");
                    obj.put("source",  s.getMetadata().getDataOrigin().getPackageName());
                    sessions.put(obj);
                }
                JSObject r = new JSObject(); r.put("sessions", sessions); call.resolve(r);
            } catch (SecurityException e) { call.reject(e.getMessage(), "permission");
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    // ── Extended vitals helpers ───────────────────────────────────────────────

    private long sumSteps(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<StepsRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(StepsRecord.class), range, Collections.emptySet(), true, 1000, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<StepsRecord> resp = (ReadRecordsResponse<StepsRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
        long total = 0;
        for (StepsRecord r : resp.getRecords()) total += r.getCount();
        return total;
    }

    private double sumDistance(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<DistanceRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(DistanceRecord.class), range, Collections.emptySet(), true, 1000, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<DistanceRecord> resp = (ReadRecordsResponse<DistanceRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
        double total = 0;
        for (DistanceRecord r : resp.getRecords()) total += r.getDistance().inMeters();
        return total;
    }

    private double sumCalories(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<ActiveCaloriesBurnedRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(ActiveCaloriesBurnedRecord.class), range, Collections.emptySet(), true, 1000, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<ActiveCaloriesBurnedRecord> resp =
                (ReadRecordsResponse<ActiveCaloriesBurnedRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
        double total = 0;
        for (ActiveCaloriesBurnedRecord r : resp.getRecords()) total += r.getEnergy().inCalories();
        return total;
    }

    /** Returns [avgBpm, minBpm, maxBpm] — all 0 when no HR data. */
    private int[] avgHr(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<HeartRateRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(HeartRateRecord.class), range, Collections.emptySet(), true, 1000, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<HeartRateRecord> resp = (ReadRecordsResponse<HeartRateRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
        long sum = 0, count = 0, minBpm = Long.MAX_VALUE, maxBpm = 0;
        for (HeartRateRecord r : resp.getRecords()) {
            for (HeartRateRecord.Sample s : r.getSamples()) {
                long bpm = s.getBeatsPerMinute(); sum += bpm; count++;
                if (bpm < minBpm) minBpm = bpm;
                if (bpm > maxBpm) maxBpm = bpm;
            }
        }
        if (count == 0) return new int[]{0, 0, 0};
        return new int[]{(int)(sum / count), (int)minBpm, (int)maxBpm};
    }

    /** Latest resting HR sample in the range, or 0. */
    private int latestRestingHR(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<RestingHeartRateRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(RestingHeartRateRecord.class), range, Collections.emptySet(), false, 10, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<RestingHeartRateRecord> resp =
                (ReadRecordsResponse<RestingHeartRateRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
        List<RestingHeartRateRecord> records = resp.getRecords();
        if (records.isEmpty()) return 0;
        return (int) records.get(records.size() - 1).getBeatsPerMinute();
    }

    /** Average RMSSD HRV for the range in ms, or 0. */
    private double avgHrv(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<HeartRateVariabilityRmssdRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(HeartRateVariabilityRmssdRecord.class), range, Collections.emptySet(), true, 100, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<HeartRateVariabilityRmssdRecord> resp =
                (ReadRecordsResponse<HeartRateVariabilityRmssdRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
        if (resp.getRecords().isEmpty()) return 0;
        double sum = 0;
        for (HeartRateVariabilityRmssdRecord r : resp.getRecords()) sum += r.getHeartRateVariabilityMillis();
        return Math.round(sum / resp.getRecords().size() * 10.0) / 10.0;
    }

    /** Average SpO2 for the range (0–100), or 0. */
    private double avgSpo2(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<OxygenSaturationRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(OxygenSaturationRecord.class), range, Collections.emptySet(), true, 100, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<OxygenSaturationRecord> resp =
                (ReadRecordsResponse<OxygenSaturationRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
        if (resp.getRecords().isEmpty()) return 0;
        double sum = 0;
        for (OxygenSaturationRecord r : resp.getRecords()) sum += r.getPercentage().getValue();
        return Math.round(sum / resp.getRecords().size() * 10.0) / 10.0;
    }

    /** Average respiratory rate (breaths/min) for the range, or 0. */
    private double avgRespiratoryRate(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<RespiratoryRateRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(RespiratoryRateRecord.class), range, Collections.emptySet(), true, 100, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<RespiratoryRateRecord> resp =
                (ReadRecordsResponse<RespiratoryRateRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
        if (resp.getRecords().isEmpty()) return 0;
        double sum = 0;
        for (RespiratoryRateRecord r : resp.getRecords()) sum += r.getRate();
        return Math.round(sum / resp.getRecords().size() * 10.0) / 10.0;
    }

    /** Latest VO2 Max (ml/kg/min) in the range, or 0. */
    private double latestVo2Max(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<Vo2MaxRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(Vo2MaxRecord.class), range, Collections.emptySet(), false, 10, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<Vo2MaxRecord> resp = (ReadRecordsResponse<Vo2MaxRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
        if (resp.getRecords().isEmpty()) return 0;
        return Math.round(resp.getRecords().get(resp.getRecords().size() - 1)
                .getVo2MillilitersPerMinuteKilogram() * 10.0) / 10.0;
    }

    /** Whether any irregular rhythm alert (AFib) appears in the range. */
    private boolean hasIrregularRhythm(TimeRangeFilter range) throws InterruptedException {
        try {
            ReadRecordsRequest<IrregularRhythmNotificationRecord> req = new ReadRecordsRequest<>(
                    JvmClassMappingKt.getKotlinClass(IrregularRhythmNotificationRecord.class),
                    range, Collections.emptySet(), false, 10, null);
            @SuppressWarnings("unchecked")
            ReadRecordsResponse<IrregularRhythmNotificationRecord> resp =
                    (ReadRecordsResponse<IrregularRhythmNotificationRecord>)
                    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
            for (IrregularRhythmNotificationRecord r : resp.getRecords()) {
                if (r.getIrregularRhythmStatus() == IrregularRhythmNotificationRecord.IRREGULAR_RHYTHM_STATUS_IRREGULAR) return true;
            }
        } catch (Exception ignored) { /* record type may not exist on older HC SDK */ }
        return false;
    }

    /** Latest mood rating (1–5) in the range, or 0 if none. */
    private int latestMood(TimeRangeFilter range) throws InterruptedException {
        try {
            ReadRecordsRequest<MoodObservationRecord> req = new ReadRecordsRequest<>(
                    JvmClassMappingKt.getKotlinClass(MoodObservationRecord.class),
                    range, Collections.emptySet(), false, 10, null);
            @SuppressWarnings("unchecked")
            ReadRecordsResponse<MoodObservationRecord> resp =
                    (ReadRecordsResponse<MoodObservationRecord>)
                    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) -> client().readRecords(req, c));
            if (!resp.getRecords().isEmpty()) {
                return resp.getRecords().get(resp.getRecords().size() - 1).getRating();
            }
        } catch (Exception ignored) { /* record type may not be available on all SDK versions */ }
        return 0;
    }

    // ── Record builders ───────────────────────────────────────────────────────

    private static ExerciseSessionRecord session(JSONObject s, long version) throws JSONException {
        Instant start = Instant.ofEpochMilli(s.getLong("start"));
        Instant end   = Instant.ofEpochMilli(s.getLong("end"));
        String title  = s.optString("title", "");
        String notes  = s.optString("notes", "");
        return new ExerciseSessionRecord(
                start, offsetAt(start), end, offsetAt(end),
                Metadata.manualEntry(s.getString("id"), version),
                exerciseType(s.optString("type")),
                title.isEmpty() ? null : title,
                notes.isEmpty() ? null : notes);
    }

    private static WeightRecord weight(JSONObject w, long version) throws JSONException {
        Instant time = Instant.ofEpochMilli(w.getLong("time"));
        return new WeightRecord(time, offsetAt(time), Mass.kilograms(w.getDouble("kg")),
                Metadata.manualEntry(w.getString("id"), version));
    }

    /** Delegates to NutritionHelper.kt so Java avoids the ~40-parameter Kotlin constructor. */
    private static NutritionRecord nutritionRecord(JSONObject n, long version) throws JSONException {
        Instant start = Instant.ofEpochMilli(n.getLong("start"));
        Instant end   = Instant.ofEpochMilli(n.getLong("end"));
        String name   = n.optString("name", "");
        return NutritionHelper.build(
                n.getString("id"), version,
                start, offsetAt(start),
                end,   offsetAt(end),
                name.isEmpty() ? null : name,
                n.has("calories")     ? n.getDouble("calories")     : null,
                n.has("protein")      ? n.getDouble("protein")      : null,
                n.has("carbs")        ? n.getDouble("carbs")        : null,
                n.has("fat")          ? n.getDouble("fat")          : null,
                n.has("fiber")        ? n.getDouble("fiber")        : null,
                n.has("sugar")        ? n.getDouble("sugar")        : null,
                n.has("saturatedFat") ? n.getDouble("saturatedFat") : null,
                n.has("sodium")       ? n.getDouble("sodium")       : null
        );
    }

    private static HydrationRecord hydrationRecord(JSONObject h, long version) throws JSONException {
        Instant start = Instant.ofEpochMilli(h.getLong("start"));
        Instant end   = Instant.ofEpochMilli(h.getLong("end"));
        return new HydrationRecord(start, offsetAt(start), end, offsetAt(end),
                Metadata.manualEntry(h.getString("id"), version),
                Volume.liters(h.getDouble("volumeMl") / 1000.0));
    }

    // ── General helpers ───────────────────────────────────────────────────────

    private void delete(Class<? extends Record> type, List<String> clientIds) throws InterruptedException {
        for (int from = 0; from < clientIds.size(); from += CHUNK) {
            List<String> part = clientIds.subList(from, Math.min(clientIds.size(), from + CHUNK));
            BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (sc, c) ->
                    client().deleteRecords(JvmClassMappingKt.getKotlinClass(type), Collections.emptyList(), part, c));
        }
    }

    private static List<String> ids(JSArray array) throws JSONException {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) out.add(array.getString(i));
        return out;
    }

    private static ZoneOffset offsetAt(Instant at) {
        return ZoneId.systemDefault().getRules().getOffset(at);
    }

    private static long todayStartMs() {
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.set(java.util.Calendar.HOUR_OF_DAY, 0);
        c.set(java.util.Calendar.MINUTE, 0);
        c.set(java.util.Calendar.SECOND, 0);
        c.set(java.util.Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private static String exerciseTypeName(int type) {
        switch (type) {
            case ExerciseSessionRecord.EXERCISE_TYPE_RUNNING:           return "running";
            case ExerciseSessionRecord.EXERCISE_TYPE_WALKING:           return "walking";
            case ExerciseSessionRecord.EXERCISE_TYPE_BIKING:            return "biking";
            case ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY: return "biking_stationary";
            case ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL:     return "swimming";
            case ExerciseSessionRecord.EXERCISE_TYPE_HIKING:            return "hiking";
            case ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING: return "strength_training";
            default:                                                      return "other";
        }
    }

    private static int exerciseType(String name) {
        switch (name) {
            case "strength_training":  return ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING;
            case "walking":            return ExerciseSessionRecord.EXERCISE_TYPE_WALKING;
            case "running":            return ExerciseSessionRecord.EXERCISE_TYPE_RUNNING;
            case "biking_stationary":  return ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY;
            case "elliptical":         return ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL;
            case "stair_climbing_machine": return ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE;
            default:                   return ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT;
        }
    }
}
