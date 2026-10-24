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
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;
import androidx.health.connect.client.units.Mass;
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
 * Writes finished workouts and weigh-ins to Health Connect (#200), the phone's own store for
 * health data, so other apps can read them. Write-only and off until the user turns it on in
 * Settings: no permission is asked for before that. What to write is worked out in JS
 * (lib/health-connect.js); this side only turns those plain objects into records.
 *
 * Every record carries openGym's own id as its clientRecordId, so writing it again replaces it,
 * and "remove" finds exactly the records openGym wrote. The version is the time of the write:
 * Health Connect keeps a rewritten record only when its version is higher than the stored one.
 *
 * The client's API is Kotlin suspend functions. They are called from a worker thread through
 * runBlocking, which keeps the Android project Java-only.
 *
 * The client library needs Android 8 (API 26) and Health Connect itself Android 9 (API 28); the
 * app supports Android 6, so every entry point checks the version before a Health Connect class
 * is touched, and answers "unsupported" below 9.
 *
 * Usage from JS (lib/health-sync.js):
 *   const HC = registerPlugin('HealthConnect');
 *   await HC.status();              // { status: 'available' | 'update' | 'missing' | 'unsupported', granted }
 *   await HC.requestPermissions();  // { granted }
 *   await HC.write({ sessions: [...], weights: [...] });
 *   await HC.remove({ sessions: [ids], weights: [ids] });
 *   await HC.openSettings();        // Health Connect's data screen, or its store page
 */
@CapacitorPlugin(name = "HealthConnect")
public class HealthConnectPlugin extends Plugin {

    private static final String PROVIDER = "com.google.android.apps.healthdata";
    // Write permissions (existing)
    private static final String WRITE_EXERCISE = "android.permission.health.WRITE_EXERCISE";
    private static final String WRITE_WEIGHT   = "android.permission.health.WRITE_WEIGHT";
    // Read permissions (new)
    private static final String READ_STEPS    = "android.permission.health.READ_STEPS";
    private static final String READ_DISTANCE = "android.permission.health.READ_DISTANCE";
    private static final String READ_CALORIES = "android.permission.health.READ_ACTIVE_CALORIES_BURNED";
    private static final String READ_HR       = "android.permission.health.READ_HEART_RATE";
    private static final String READ_EXERCISE = "android.permission.health.READ_EXERCISE";
    // Health Connect takes at most this many records in one insert.
    private static final int CHUNK = 500;

    // One at a time, in order: a remove queued behind a write must not overtake it.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    private static Set<String> permissions() {
        Set<String> p = new HashSet<>();
        p.add(WRITE_EXERCISE);
        p.add(WRITE_WEIGHT);
        return p;
    }

    private static Set<String> readPermissions() {
        Set<String> p = new HashSet<>();
        p.add(READ_STEPS);
        p.add(READ_DISTANCE);
        p.add(READ_CALORIES);
        p.add(READ_HR);
        p.add(READ_EXERCISE);
        return p;
    }

    private String sdkStatus() {
        if (!supported()) return "unsupported";
        int s = HealthConnectClient.Companion.getSdkStatus(getContext(), PROVIDER);
        if (s == HealthConnectClient.SDK_AVAILABLE) return "available";
        if (s == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update";
        // Android 13 and lower need the Health Connect app; 14 and up have it built in, so
        // "missing" there means the phone has no Health Connect at all (some Android Go builds).
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

    @PluginMethod
    public void status(PluginCall call) {
        String status = sdkStatus();
        if (!"available".equals(status)) {
            JSObject r = new JSObject();
            r.put("status", status);
            r.put("granted", false);
            call.resolve(r);
            return;
        }
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("status", status);
                r.put("granted", granted().containsAll(permissions()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), permissions());
        startActivityForResult(call, intent, "permissionsResult");
    }

    @ActivityCallback
    private void permissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Set<String> got = contract.parseResult(result.getResultCode(), result.getData());
        // The dialog answers only for this time; ask Health Connect what stands now, since the
        // user may also have granted one of the two and not the other.
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("granted", (got != null && got.containsAll(permissions())) || granted().containsAll(permissions()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights = call.getArray("weights", new JSArray());
        worker.execute(() -> {
            try {
                long version = System.currentTimeMillis();
                List<Record> records = new ArrayList<>();
                for (int i = 0; i < sessions.length(); i++) records.add(session(sessions.getJSONObject(i), version));
                for (int i = 0; i < weights.length(); i++) records.add(weight(weights.getJSONObject(i), version));
                for (int from = 0; from < records.size(); from += CHUNK) {
                    List<Record> part = records.subList(from, Math.min(records.size(), from + CHUNK));
                    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().insertRecords(part, cont));
                }
                call.resolve();
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights = call.getArray("weights", new JSArray());
        worker.execute(() -> {
            try {
                delete(ExerciseSessionRecord.class, ids(sessions));
                delete(WeightRecord.class, ids(weights));
                call.resolve();
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    // Health Connect's own screen for the data apps wrote, where the user can look at and delete
    // what openGym wrote. Without Health Connect (Android 13 and lower), its store page instead.
    @PluginMethod
    public void openSettings(PluginCall call) {
        String status = sdkStatus();
        if ("unsupported".equals(status)) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        try {
            Intent intent = "available".equals(status)
                    ? HealthConnectClient.Companion.getHealthConnectManageDataIntent(getContext(), PROVIDER)
                    : new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + PROVIDER + "&url=healthconnect%3A%2F%2Fonboarding"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), "failed");
        }
    }

    // ── Read permissions ──────────────────────────────────────────────────────────

    /** { granted: bool } — whether all five read permissions are held. */
    @PluginMethod
    public void statusRead(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            JSObject r = new JSObject(); r.put("granted", false); call.resolve(r); return;
        }
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("granted", granted().containsAll(readPermissions()));
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    /** Asks for READ_STEPS, READ_DISTANCE, READ_ACTIVE_CALORIES_BURNED, READ_HEART_RATE, READ_EXERCISE. */
    @PluginMethod
    public void requestReadPermissions(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable"); return;
        }
        ActivityResultContract<Set<String>, Set<String>> contract =
                PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), readPermissions());
        startActivityForResult(call, intent, "readPermissionsResult");
    }

    @ActivityCallback
    private void readPermissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ActivityResultContract<Set<String>, Set<String>> contract =
                PermissionController.createRequestPermissionResultContract(PROVIDER);
        Set<String> got = contract.parseResult(result.getResultCode(), result.getData());
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("granted", (got != null && got.containsAll(readPermissions()))
                        || granted().containsAll(readPermissions()));
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    // ── Read vitals ───────────────────────────────────────────────────────────────

    /**
     * Reads aggregated health data for a date range.
     * Call: HC.readDaily({ startMs: long, endMs: long })
     * Returns: { steps: long, distanceM: double, calories: double, avgBpm: int, minBpm: int, maxBpm: int }
     *
     * All fields default to 0 when no data is available (no wearable, no source app, etc).
     * distanceM is in metres; calories is active (exercise) calories only.
     */
    @PluginMethod
    public void readDaily(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable"); return;
        }
        long startMs = call.getLong("startMs", todayStartMs());
        long endMs   = call.getLong("endMs",   System.currentTimeMillis());
        worker.execute(() -> {
            try {
                Instant start = Instant.ofEpochMilli(startMs);
                Instant end   = Instant.ofEpochMilli(endMs);
                TimeRangeFilter range = TimeRangeFilter.Companion.between(start, end);

                long   steps    = sumSteps(range);
                double distM    = sumDistance(range);
                double calories = sumCalories(range);
                int[]  hr       = avgHr(range);

                JSObject r = new JSObject();
                r.put("steps",    steps);
                r.put("distanceM", distM);
                r.put("calories", calories);
                r.put("avgBpm",   hr[0]);
                r.put("minBpm",   hr[1]);
                r.put("maxBpm",   hr[2]);
                call.resolve(r);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    /**
     * Reads exercise sessions (runs, walks, cycles…) logged by any app in the time range.
     * Call: HC.readExerciseSessions({ startMs: long, endMs: long })
     * Returns: { sessions: [{ id, startMs, endMs, type, title, distanceM, source }] }
     *
     * Only sessions with a meaningful distance (> 0) and duration (> 30 s) are included.
     * `source` is the originating app's package name (e.g. "com.google.android.apps.fitness").
     */
    @PluginMethod
    public void readExerciseSessions(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable"); return;
        }
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
                                EmptyCoroutineContext.INSTANCE,
                                (scope, cont) -> client().readRecords(req, cont));

                JSArray sessions = new JSArray();
                for (ExerciseSessionRecord s : resp.getRecords()) {
                    long dur = s.getEndTime().toEpochMilli() - s.getStartTime().toEpochMilli();
                    if (dur < 30000) continue;  // skip < 30 s
                    // Skip sessions openGym itself wrote (prefixed opengym-w-)
                    String clientId = s.getMetadata().getClientRecordId();
                    if (clientId != null && clientId.startsWith("opengym-w-")) continue;
                    JSObject obj = new JSObject();
                    obj.put("id",        s.getMetadata().getId());
                    obj.put("startMs",   s.getStartTime().toEpochMilli());
                    obj.put("endMs",     s.getEndTime().toEpochMilli());
                    obj.put("type",      exerciseTypeName(s.getExerciseType()));
                    obj.put("title",     s.getTitle() != null ? s.getTitle() : "");
                    obj.put("source",    s.getMetadata().getDataOrigin().getPackageName());
                    sessions.put(obj);
                }
                JSObject r = new JSObject();
                r.put("sessions", sessions);
                call.resolve(r);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    // ── Read helpers ──────────────────────────────────────────────────────────────

    private long sumSteps(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<StepsRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(StepsRecord.class),
                range, Collections.emptySet(), true, 1000, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<StepsRecord> resp = (ReadRecordsResponse<StepsRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
                        (scope, cont) -> client().readRecords(req, cont));
        long total = 0;
        for (StepsRecord r : resp.getRecords()) total += r.getCount();
        return total;
    }

    private double sumDistance(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<DistanceRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(DistanceRecord.class),
                range, Collections.emptySet(), true, 1000, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<DistanceRecord> resp = (ReadRecordsResponse<DistanceRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
                        (scope, cont) -> client().readRecords(req, cont));
        double total = 0;
        for (DistanceRecord r : resp.getRecords()) total += r.getDistance().inMeters();
        return total;
    }

    private double sumCalories(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<ActiveCaloriesBurnedRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(ActiveCaloriesBurnedRecord.class),
                range, Collections.emptySet(), true, 1000, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<ActiveCaloriesBurnedRecord> resp =
                (ReadRecordsResponse<ActiveCaloriesBurnedRecord>) BuildersKt.runBlocking(
                        EmptyCoroutineContext.INSTANCE,
                        (scope, cont) -> client().readRecords(req, cont));
        double total = 0;
        for (ActiveCaloriesBurnedRecord r : resp.getRecords())
            total += r.getEnergy().inCalories();
        return total;
    }

    /** Returns [avgBpm, minBpm, maxBpm] — all 0 when no HR data. */
    private int[] avgHr(TimeRangeFilter range) throws InterruptedException {
        ReadRecordsRequest<HeartRateRecord> req = new ReadRecordsRequest<>(
                JvmClassMappingKt.getKotlinClass(HeartRateRecord.class),
                range, Collections.emptySet(), true, 1000, null);
        @SuppressWarnings("unchecked")
        ReadRecordsResponse<HeartRateRecord> resp = (ReadRecordsResponse<HeartRateRecord>)
                BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
                        (scope, cont) -> client().readRecords(req, cont));
        long sum = 0, count = 0, minBpm = Long.MAX_VALUE, maxBpm = 0;
        for (HeartRateRecord r : resp.getRecords()) {
            for (HeartRateRecord.Sample s : r.getSamples()) {
                long bpm = s.getBeatsPerMinute();
                sum += bpm; count++;
                if (bpm < minBpm) minBpm = bpm;
                if (bpm > maxBpm) maxBpm = bpm;
            }
        }
        if (count == 0) return new int[]{ 0, 0, 0 };
        return new int[]{ (int)(sum / count), (int)minBpm, (int)maxBpm };
    }

    private static long todayStartMs() {
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.set(java.util.Calendar.HOUR_OF_DAY, 0);
        c.set(java.util.Calendar.MINUTE, 0);
        c.set(java.util.Calendar.SECOND, 0);
        c.set(java.util.Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** Human-readable type name for an ExerciseSessionRecord type constant. */
    private static String exerciseTypeName(int type) {
        switch (type) {
            case ExerciseSessionRecord.EXERCISE_TYPE_RUNNING:          return "running";
            case ExerciseSessionRecord.EXERCISE_TYPE_WALKING:          return "walking";
            case ExerciseSessionRecord.EXERCISE_TYPE_BIKING:           return "biking";
            case ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY:return "biking_stationary";
            case ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL:    return "swimming";
            case ExerciseSessionRecord.EXERCISE_TYPE_HIKING:           return "hiking";
            case ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING:return "strength_training";
            default:                                                    return "other";
        }
    }

    private void delete(Class<? extends Record> type, List<String> clientIds) throws InterruptedException {
        for (int from = 0; from < clientIds.size(); from += CHUNK) {
            List<String> part = clientIds.subList(from, Math.min(clientIds.size(), from + CHUNK));
            BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) ->
                    client().deleteRecords(JvmClassMappingKt.getKotlinClass(type), Collections.emptyList(), part, cont));
        }
    }

    private static List<String> ids(JSArray array) throws JSONException {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) out.add(array.getString(i));
        return out;
    }

    // The offset in force at that moment where the phone is now: what Health Connect shows the
    // session's local time with.
    private static ZoneOffset offsetAt(Instant at) {
        return ZoneId.systemDefault().getRules().getOffset(at);
    }

    private static ExerciseSessionRecord session(JSONObject s, long version) throws JSONException {
        Instant start = Instant.ofEpochMilli(s.getLong("start"));
        Instant end = Instant.ofEpochMilli(s.getLong("end"));
        String title = s.optString("title", "");
        String notes = s.optString("notes", "");
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

    // The names lib/health-connect.js uses (SESSION_TYPES); anything else is "other".
    private static int exerciseType(String name) {
        switch (name) {
            case "strength_training": return ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING;
            case "walking": return ExerciseSessionRecord.EXERCISE_TYPE_WALKING;
            case "running": return ExerciseSessionRecord.EXERCISE_TYPE_RUNNING;
            case "biking_stationary": return ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY;
            case "elliptical": return ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL;
            case "stair_climbing_machine": return ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE;
            default: return ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT;
        }
    }
}
