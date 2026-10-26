package agency.tryout.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.*
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

// Default non-biometric Expo SecureStore wire format and AndroidKeyStore aliases.
// Never replace a missing/unreadable key on a read or silently discard ciphertext.
class TryOutSecureStore(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "TryOutSecureStore"
  private val prefs = context.getSharedPreferences("SecureStore", Context.MODE_PRIVATE)
  private val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private val currentAlias = "AES/GCM/NoPadding:key_v1:keystoreUnauthenticated"
  private fun valid(key: String) { require(key.matches(Regex("[A-Za-z0-9._-]+"))) }
  private fun run(promise: Promise, work: () -> Any?) {
    try { synchronized(this) { promise.resolve(work()) } }
    catch (_: Exception) { promise.reject("secure_store", "Secure storage operation failed; existing data was preserved.") }
  }
  @ReactMethod fun getItem(key: String, promise: Promise) = run(promise) {
    valid(key)
    val raw = prefs.getString("key_v1-$key", null) ?: prefs.getString(key, null)
    if (raw == null) null else {
      val item = JSONObject(raw)
      require(item.getString("scheme") == "aes" && !item.optBoolean("requireAuthentication", false))
      val alias = if (item.optBoolean("usesKeystoreSuffix", false)) currentAlias else "AES/GCM/NoPadding:key_v1"
      val entry = keys.getEntry(alias, null) as? KeyStore.SecretKeyEntry
        ?: error("Existing encryption key unavailable")
      val tagLength = item.getInt("tlen")
      require(tagLength in 96..128 && tagLength % 8 == 0)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, entry.secretKey, GCMParameterSpec(tagLength, Base64.decode(item.getString("iv"), Base64.DEFAULT)))
      String(cipher.doFinal(Base64.decode(item.getString("ct"), Base64.DEFAULT)), Charsets.UTF_8)
    }
  }
  @ReactMethod fun setItem(key: String, value: String, promise: Promise) = run(promise) {
    valid(key)
    // Refuse to replace unreadable existing data or a lost keystore alias.
    val existing = prefs.getString("key_v1-$key", null) ?: prefs.getString(key, null)
    if (existing != null) {
      val item = JSONObject(existing)
      require(item.getString("scheme") == "aes" && !item.optBoolean("requireAuthentication", false))
      val alias = if (item.optBoolean("usesKeystoreSuffix", false)) currentAlias else "AES/GCM/NoPadding:key_v1"
      check(keys.containsAlias(alias))
    }
    var entry = keys.getEntry(currentAlias, null) as? KeyStore.SecretKeyEntry
    if (entry == null) {
      check(!keys.containsAlias(currentAlias))
      val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      generator.init(KeyGenParameterSpec.Builder(currentAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setUserAuthenticationRequired(false).build())
      generator.generateKey()
      entry = keys.getEntry(currentAlias, null) as KeyStore.SecretKeyEntry
    }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, entry.secretKey)
    val spec = cipher.parameters.getParameterSpec(GCMParameterSpec::class.java)
    val item = JSONObject().put("scheme", "aes").put("usesKeystoreSuffix", true)
      .put("keystoreAlias", "key_v1").put("requireAuthentication", false)
      .put("ct", Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
      .put("iv", Base64.encodeToString(spec.iv, Base64.NO_WRAP)).put("tlen", spec.tLen)
    check(prefs.edit().putString("key_v1-$key", item.toString()).remove(key).commit())
    null
  }
  @ReactMethod fun deleteItem(key: String, promise: Promise) = run(promise) {
    valid(key)
    check(prefs.edit().remove("key_v1-$key").remove(key).commit())
    check(reactApplicationContext.getSharedPreferences(reactApplicationContext.packageName + "_preferences", Context.MODE_PRIVATE).edit().remove(key).commit())
    null
  }
}
