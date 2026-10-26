package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

// PrintDocumentAdapter's callback constructors have package visibility. Keep the
// callback subclasses alongside the platform print API, as Android HTML-to-PDF
// converters do, without introducing a second PDF parser or logging report HTML.
public final class TryOutReportCallbacks {
  public interface Result { void finish(boolean success); }
  private TryOutReportCallbacks() {}

  public static void layout(PrintDocumentAdapter printer, PrintAttributes attributes,
      CancellationSignal signal, Result result) {
    printer.onLayout(null, attributes, signal, new PrintDocumentAdapter.LayoutResultCallback() {
      @Override public void onLayoutFinished(PrintDocumentInfo info, boolean changed) { result.finish(true); }
      @Override public void onLayoutFailed(CharSequence error) { result.finish(false); }
      @Override public void onLayoutCancelled() { result.finish(false); }
    }, null);
  }

  public static void write(PrintDocumentAdapter printer, ParcelFileDescriptor output,
      CancellationSignal signal, Result result) {
    printer.onWrite(new PageRange[] { PageRange.ALL_PAGES }, output, signal,
      new PrintDocumentAdapter.WriteResultCallback() {
        @Override public void onWriteFinished(PageRange[] pages) { result.finish(true); }
        @Override public void onWriteFailed(CharSequence error) { result.finish(false); }
        @Override public void onWriteCancelled() { result.finish(false); }
      });
  }
}
