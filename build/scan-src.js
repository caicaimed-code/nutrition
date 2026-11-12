// Barcode reading for the app (loaded only when someone opens the scanner).
// The app talks to window.ScanSDK; tests swap in a fake with the same shape.
//
// Accuracy:
// - Uses the phone's built-in barcode reader (BarcodeDetector) when it has one (Android Chrome),
//   otherwise ZXing (iPhone).
// - Asks for a sharper camera picture (1920x1080) with continuous focus.
// - Only accepts a code after it is read the same way twice in a row, and checks the check digit.
// Flash: start() reports whether the camera has a torch; torch(on) switches it.
// Photo: decodeFile(file) reads a barcode from a photo taken with the phone's own camera app
// (no camera permission prompt, and the camera app has its own flash).
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

function makeReader() {
  var hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 50 });
}

// GTIN check digit (EAN-13, UPC-A, EAN-8). UPC-E (8 digits starting with 0 or 1) is checked by the reader itself.
function checkDigitOk(code) {
  if (!/^\d+$/.test(code)) return false;
  if (code.length === 8 && (code[0] === "0" || code[0] === "1")) return true;
  if ([8, 12, 13, 14].indexOf(code.length) < 0) return false;
  var sum = 0;
  for (var i = code.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += +code[i] * w;
  return (10 - (sum % 10)) % 10 === +code[code.length - 1];
}

var FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
function nativeDetector() {
  if (!("BarcodeDetector" in window)) return Promise.resolve(null);
  return window.BarcodeDetector.getSupportedFormats().then(function (f) {
    var want = FORMATS.filter(function (x) { return f.indexOf(x) >= 0; });
    return want.length ? new window.BarcodeDetector({ formats: want }) : null;
  }).catch(function () { return null; });
}

window.ScanSDK = {
  // Starts the camera in a <video>, calls onCode(text) once a barcode is read twice the same way,
  // onReady({ torch: bool }) when the picture is up. Returns { stop(), torch(on) }.
  start: function (video, onCode, onError, onReady) {
    var stopped = false, stream = null, track = null, controls = null, timer = null;
    var last = "", lastAt = 0, hits = 0;
    function seen(text) {
      if (stopped) return;
      text = String(text || "").replace(/\D/g, "");
      if (!checkDigitOk(text)) return;
      var now = Date.now();
      hits = text === last && now - lastAt < 1500 ? hits + 1 : 1;
      last = text; lastAt = now;
      if (hits >= 2) { stopped = true; onCode(text); }
    }
    function useZxing() {
      if (stopped) return;
      makeReader().decodeFromVideoElement(video, function (result) { if (result) seen(result.getText()); })
        .then(function (c) { controls = c; if (stopped) c.stop(); }, function (e) { if (!stopped) onError(e); });
    }
    function useNative(det) {
      (function loop() {
        if (stopped) return;
        det.detect(video).then(function (r) { if (r && r.length) seen(r[0].rawValue); }, function () {})
          .then(function () { if (!stopped) timer = setTimeout(loop, 60); });
      })();
    }
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(function (s) {
      if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; track = s.getVideoTracks()[0];
      try {
        var c0 = track.getCapabilities ? track.getCapabilities() : {};
        if (c0.focusMode && c0.focusMode.indexOf("continuous") >= 0) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function () {});
      } catch (e) {}
      video.setAttribute("playsinline", ""); video.muted = true;
      video.srcObject = s;
      return Promise.resolve(video.play()).catch(function () {}).then(function () {
        if (stopped) return;
        var caps = {};
        try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) {}
        if (onReady) onReady({ torch: !!caps.torch });
        return nativeDetector().then(function (det) { if (det) useNative(det); else useZxing(); });
      });
    }, function (e) { if (!stopped) onError(e); });
    return {
      stop: function () {
        stopped = true; clearTimeout(timer);
        if (controls) try { controls.stop(); } catch (e) {}
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        try { video.srcObject = null; } catch (e) {}
      },
      torch: function (on) {
        if (!track) return Promise.reject(new Error("no camera"));
        return track.applyConstraints({ advanced: [{ torch: !!on }] })
          .catch(function () { return track.applyConstraints({ torch: !!on }); });
      }
    };
  },
  // Reads a barcode from a photo file (tries a few sizes; big phone photos are slow and noisy at full size)
  decodeFile: function (file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("Couldn't open that photo.")); };
      img.src = url;
    }).then(function (img) {
      // Each size upright, then turned a quarter (a barcode photographed sideways)
      var tries = [[1600, 0], [1600, 90], [1000, 0], [1000, 90], [2400, 0], [2400, 90]], reader = makeReader();
      return nativeDetector().then(function (det) {
        function tryAt(i) {
          if (i >= tries.length) throw new Error("No barcode found in that photo.");
          var s = Math.min(1, tries[i][0] / Math.max(img.naturalWidth, img.naturalHeight)), turn = tries[i][1] === 90;
          var w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
          var c = document.createElement("canvas"), g = c.getContext("2d");
          c.width = turn ? h : w; c.height = turn ? w : h;
          if (turn) { g.translate(h, 0); g.rotate(Math.PI / 2); }
          g.drawImage(img, 0, 0, w, h);
          var p = det ? det.detect(c).then(function (r) { if (r && r.length) return r[0].rawValue; throw 0; })
            : new Promise(function (ok, no) { try { ok(reader.decodeFromCanvas(c).getText()); } catch (e) { no(e); } });
          return p.then(function (t) {
            t = String(t).replace(/\D/g, "");
            if (!checkDigitOk(t)) throw 0;
            return t;
          }).catch(function () { return tryAt(i + 1); });
        }
        return tryAt(0);
      }).then(function (t) { URL.revokeObjectURL(img.src); return t; }, function (e) { URL.revokeObjectURL(img.src); throw e; });
    });
  },
  checkDigitOk: checkDigitOk,
  // For tests: read a barcode from a picture
  decodeImage: function (url) {
    return makeReader().decodeFromImageUrl(url).then(function (r) { return r.getText(); });
  }
};
