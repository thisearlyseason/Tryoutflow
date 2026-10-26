package agency.tryout.mobile;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Offline, fictional-data device probe. Never packaged in the install APK. */
public class PlatformSmokeInstrumentation extends Instrumentation {
  @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }

  private void legacyFixture(String format, boolean suffixed) throws Exception {
    String alias = "AES/GCM/NoPadding:key_v1" + (suffixed ? ":keystoreUnauthenticated" : "");
    KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
    keys.load(null);
    if (!keys.containsAlias(alias)) {
      KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
        .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
      generator.generateKey();
    }
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, ((KeyStore.SecretKeyEntry) keys.getEntry(alias, null)).getSecretKey());
    GCMParameterSpec spec = cipher.getParameters().getParameterSpec(GCMParameterSpec.class);
    JSONObject value = new JSONObject().put("scheme", "aes").put("keystoreAlias", "key_v1")
      .put("usesKeystoreSuffix", suffixed).put("requireAuthentication", false)
      .put("ct", Base64.encodeToString(cipher.doFinal(("fictional-legacy-" + format).getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP))
      .put("iv", Base64.encodeToString(spec.getIV(), Base64.NO_WRAP)).put("tlen", spec.getTLen());
    String key = (suffixed ? "key_v1-" : "") + "native-migration-legacy-" + format;
    if (!getTargetContext().getSharedPreferences("SecureStore", Context.MODE_PRIVATE).edit().putString(key, value.toString()).commit())
      throw new Exception("Fictional legacy fixture write failed");
  }

  @Override public void onStart() {
    Bundle result = new Bundle();
    int status = Activity.RESULT_CANCELED;
    File marker = new File(getTargetContext().getCacheDir(), "native-migration-smoke.json");
    File preview = new File(getTargetContext().getCacheDir(), "native-migration-smoke-preview.pdf");
    try {
      Files.deleteIfExists(marker.toPath());
      Files.deleteIfExists(preview.toPath());
      legacyFixture("old", false);
      legacyFixture("current", true);
      Intent launch = new Intent(getTargetContext(), MainActivity.class).setAction(Intent.ACTION_MAIN)
        .addCategory(Intent.CATEGORY_LAUNCHER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      Activity activity = startActivitySync(launch);
      long deadline = System.currentTimeMillis() + 60000;
      while (!marker.exists() && System.currentTimeMillis() < deadline) Thread.sleep(200);
      JSONObject proof = new JSONObject(new String(Files.readAllBytes(marker.toPath()), StandardCharsets.UTF_8));
      if (!proof.getBoolean("passed")) throw new Exception(proof.optString("error", "Native smoke failed"));
      File output = getTargetContext().getExternalFilesDir(null);
      if (output == null) throw new Exception("Test evidence directory unavailable");
      try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(preview, ParcelFileDescriptor.MODE_READ_ONLY);
           PdfRenderer renderer = new PdfRenderer(descriptor)) {
        if (renderer.getPageCount() != 2) throw new Exception("Expected two-page PDF");
        for (int i = 0; i < 2; i++) {
          try (PdfRenderer.Page page = renderer.openPage(i)) {
            Bitmap bitmap = Bitmap.createBitmap(page.getWidth(), page.getHeight(), Bitmap.Config.ARGB_8888);
            bitmap.eraseColor(Color.WHITE);
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            try (FileOutputStream file = new FileOutputStream(new File(output, "offline-report-page-" + (i + 1) + ".png"))) {
              bitmap.compress(Bitmap.CompressFormat.PNG, 100, file);
            }
            bitmap.recycle();
          }
        }
        proof.put("pdfPages", renderer.getPageCount());
      }
      proof.put("androidApi", android.os.Build.VERSION.SDK_INT).put("offlineOnly", true);
      Files.write(new File(output, "android-native-smoke.json").toPath(), proof.toString(2).getBytes(StandardCharsets.UTF_8));
      result.putString("stream", "Android native storage, legacy-format compatibility, and two-page PDF passed.\n");
      runOnMainSync(activity::finish);
      status = Activity.RESULT_OK;
    } catch (Exception error) {
      result.putString("stream", "Offline native probe failed: " + error.getClass().getSimpleName() + ": " + error.getMessage() + "\n");
    } finally {
      marker.delete();
      preview.delete();
      getTargetContext().getSharedPreferences("SecureStore", Context.MODE_PRIVATE).edit()
        .remove("native-migration-legacy-old").remove("key_v1-native-migration-legacy-old")
        .remove("native-migration-legacy-current").remove("key_v1-native-migration-legacy-current").commit();
    }
    finish(status, result);
  }
}
