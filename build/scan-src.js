// Barcode reading for the app (loaded only when someone opens the scanner).
// The app talks to window.ScanSDK; tests swap in a fake with the same shape.
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

function makeReader() {
  var hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 60 });
}

window.ScanSDK = {
  // Starts the camera in a <video> and calls onCode(text) for each barcode it reads. Returns a stop() function.
  start: function (video, onCode, onError) {
    var reader = makeReader(), controls = null, stopped = false;
    reader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      video,
      function (result) { if (result && !stopped) onCode(result.getText()); }
    ).then(function (c) { controls = c; if (stopped) c.stop(); }, function (e) { if (!stopped) onError(e); });
    return function stop() { stopped = true; if (controls) controls.stop(); };
  },
  // For tests: read a barcode from a picture
  decodeImage: function (url) {
    return makeReader().decodeFromImageUrl(url).then(function (r) { return r.getText(); });
  }
};
