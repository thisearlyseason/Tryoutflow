package agency.tryout.mobile

import android.app.Activity
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import java.io.File

class TryOutReports(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "TryOutReports"
  private val main = Handler(Looper.getMainLooper())
  private var busy = false
  private var sharePromise: Promise? = null
  init {
    context.addActivityEventListener(object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == 8741) { sharePromise?.resolve(null); sharePromise = null }
      }
    })
  }
  @ReactMethod fun shareFile(uri: String, mime: String, promise: Promise) {
    main.post {
      try {
        check(sharePromise == null)
        val activity = reactApplicationContext.currentActivity ?: error("No activity")
        val parsed = android.net.Uri.parse(uri)
        val file = File(parsed.path ?: error("No file"))
        require(parsed.scheme == "file" && file.canonicalFile.parentFile == reactApplicationContext.cacheDir.canonicalFile &&
          file.name.matches(Regex("tryoutflow-report-[a-f0-9-]{36}\\.(pdf|json|csv)")) &&
          mime in listOf("application/pdf", "application/json", "text/csv"))
        val shared = FileProvider.getUriForFile(reactApplicationContext, reactApplicationContext.packageName + ".rnshare.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, shared)
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.clipData = android.content.ClipData.newRawUri("TryOutFlow report", shared)
        sharePromise = promise
        activity.startActivityForResult(Intent.createChooser(intent, "Share report"), 8741)
      } catch (_: Exception) {
        if (sharePromise === promise) sharePromise = null
        promise.reject("report_share", "The report could not be shared.")
      }
    }
  }
  @ReactMethod fun printToFile(html: String, name: String, promise: Promise) {
    main.post {
      if (busy || !name.matches(Regex("tryoutflow-report-[a-f0-9-]{36}\\.pdf")) || html.length > 20000000) {
        promise.reject("report_pdf", "Report preparation is unavailable.")
        return@post
      }
      busy = true
      val file = File(reactApplicationContext.cacheDir, name)
      val web = WebView(reactApplicationContext)
      var closed = false
      var activePrinter: android.print.PrintDocumentAdapter? = null
      var activeOutput: android.os.ParcelFileDescriptor? = null
      val signal = android.os.CancellationSignal()
      fun finish(success: Boolean) {
        if (closed) return
        closed = true
        signal.cancel()
        activeOutput?.close()
        activePrinter?.onFinish()
        web.stopLoading(); web.destroy(); busy = false
        if (success) promise.resolve(android.net.Uri.fromFile(file).toString())
        else { file.delete(); promise.reject("report_pdf", "The report could not be prepared.") }
      }
      web.settings.javaScriptEnabled = false
      web.settings.allowFileAccess = false
      web.settings.allowContentAccess = false
      web.settings.blockNetworkLoads = false
      web.setInitialScale(100)
      web.measure(android.view.View.MeasureSpec.makeMeasureSpec(612, android.view.View.MeasureSpec.EXACTLY),
        android.view.View.MeasureSpec.makeMeasureSpec(792, android.view.View.MeasureSpec.EXACTLY))
      web.layout(0, 0, 612, 792)
      web.webViewClient = object : WebViewClient() {
        private var started = false
        override fun onPageFinished(view: WebView, url: String) {
          if (closed || started) return
          started = true
          try {
            val printer = view.createPrintDocumentAdapter("TryOutFlow report")
            activePrinter = printer
            val attributes = android.print.PrintAttributes.Builder()
              .setMediaSize(android.print.PrintAttributes.MediaSize.NA_LETTER)
              .setResolution(android.print.PrintAttributes.Resolution("pdf", "PDF", 300, 300))
              .setMinMargins(android.print.PrintAttributes.Margins.NO_MARGINS).build()
            printer.onStart()
            android.print.TryOutReportCallbacks.layout(printer, attributes, signal) { laidOut ->
              if (!closed) {
                if (!laidOut) finish(false)
                else {
                  try {
                    val output = android.os.ParcelFileDescriptor.open(file, android.os.ParcelFileDescriptor.MODE_CREATE or
                      android.os.ParcelFileDescriptor.MODE_TRUNCATE or android.os.ParcelFileDescriptor.MODE_READ_WRITE)
                    activeOutput = output
                    android.print.TryOutReportCallbacks.write(printer, output, signal) { written ->
                      finish(written && file.length() > 0)
                    }
                  } catch (_: Exception) { finish(false) }
                }
              }
            }
          } catch (_: Exception) { finish(false) }
        }
      }
      main.postDelayed({ finish(false) }, 30000)
      web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
    }
  }
}
