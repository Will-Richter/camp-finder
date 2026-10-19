import SwiftUI
import WebKit
import CoreLocation
import UniformTypeIdentifiers

/// On-screen log for debug builds, so problems show in the simulator without the Xcode console.
final class DebugLog: ObservableObject {
    static let shared = DebugLog()
    @Published var lines: [String] = []
    func add(_ s: String) {
        print(s)
        #if DEBUG
        DispatchQueue.main.async { self.lines = Array((self.lines + [s]).suffix(10)) }
        #endif
    }
}

/// Hosts the bundled Camp Finder web app (the `web` folder) in a WKWebView.
/// Files are served from a custom `campfinder://app/` scheme so the page has a stable origin
/// (localStorage keeps saved trips) and can call the public map APIs.
struct WebAppView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "campfinder")
        config.allowsInlineMediaPlayback = true
        config.websiteDataStore = .default()

        let controller = config.userContentController
        controller.add(context.coordinator, name: "location")
        controller.add(context.coordinator, name: "nativeFetch")
        controller.add(context.coordinator, name: "log")
        controller.addUserScript(WKUserScript(source: Coordinator.logShim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(source: Coordinator.geolocationShim, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.055, green: 0.353, blue: 0.243, alpha: 1)
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        context.coordinator.webView = webView
        DebugLog.shared.add("starting load")
        webView.load(URLRequest(url: URL(string: "campfinder://app/index.html")!))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, CLLocationManagerDelegate {
        weak var webView: WKWebView?
        private let manager = CLLocationManager()
        private var pending: [Int] = []

        override init() {
            super.init()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        }

        /// Sends page errors and console.error/warn to the Xcode console.
        static let logShim = """
        (function(){
          var post = function(kind, msg){ try { window.webkit.messageHandlers.log.postMessage(kind + ': ' + msg); } catch (e) {} };
          window.addEventListener('error', function(e){ post('error', (e.message || e.type) + ' @ ' + (e.filename || (e.target && (e.target.src || e.target.href)) || '') + ':' + (e.lineno || '')); }, true);
          window.addEventListener('unhandledrejection', function(e){ post('promise', String(e.reason && (e.reason.stack || e.reason.message) || e.reason)); });
          ['error','warn','log'].forEach(function(k){ var o = console[k]; console[k] = function(){ post(k, Array.prototype.map.call(arguments, String).join(' ')); o.apply(console, arguments); }; });
          document.addEventListener('DOMContentLoaded', function(){ post('info', 'DOM ready, L=' + (typeof L) + ', app=' + (typeof window.__cf)); });
        })();
        """

        /// Replaces navigator.geolocation with a bridge to Core Location.
        static let geolocationShim = """
        (function(){
          var cbs = {}, next = 1;
          window.__cfLocation = function(id, ok, lat, lon, acc, msg){
            var c = cbs[id]; if (!c) return; delete cbs[id];
            if (ok) c.s({coords:{latitude:lat, longitude:lon, accuracy:acc}, timestamp:Date.now()});
            else if (c.e) c.e({code:1, message:msg});
          };
          var geo = {
            getCurrentPosition: function(s, e){ var id = next++; cbs[id] = {s:s, e:e};
              window.webkit.messageHandlers.location.postMessage(id); },
            watchPosition: function(s, e){ geo.getCurrentPosition(s, e); return 0; },
            clearWatch: function(){}
          };
          try { Object.defineProperty(navigator, 'geolocation', {value: geo, configurable: true}); } catch (err) {}
        })();
        """

        // MARK: location bridge
        /// Official data hosts the web app may read through the app (no browser CORS limits).
        private static let fetchHosts: Set<String> = [
            "spatial.infrastructure.gov.au", "opendata.maps.vic.gov.au",
            "catalogue.data.infrastructure.gov.au", "spatial-gis.information.qld.gov.au",
        ]

        private func handleFetch(_ body: Any) {
            guard let dict = body as? [String: Any], let id = dict["id"] as? Int,
                  let str = dict["url"] as? String, let url = URL(string: str),
                  url.scheme == "https", let host = url.host, Self.fetchHosts.contains(host) else { return }
            var req = URLRequest(url: url, timeoutInterval: 25)
            req.setValue("CampFinder/1.0 (iOS)", forHTTPHeaderField: "User-Agent")
            URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
                let ok = error == nil && ((response as? HTTPURLResponse)?.statusCode ?? 0) < 400 && data != nil
                let text = ok ? String(decoding: data!, as: UTF8.self) : (error?.localizedDescription ?? "HTTP error")
                let payload = (try? JSONSerialization.data(withJSONObject: [text], options: [.fragmentsAllowed])).map { String(decoding: $0, as: UTF8.self) } ?? "[\"\"]"
                DispatchQueue.main.async {
                    self?.webView?.evaluateJavaScript("window.__cfFetchDone(\(id), \(ok), \(payload)[0])")
                }
            }.resume()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "nativeFetch" { handleFetch(message.body); return }
            if message.name == "log" { DebugLog.shared.add("web \(message.body)"); return }
            guard message.name == "location", let id = message.body as? Int else { return }
            pending.append(id)
            switch manager.authorizationStatus {
            case .notDetermined: manager.requestWhenInUseAuthorization()
            case .denied, .restricted: finishAll(error: "Location permission is off")
            default: manager.requestLocation()
            }
        }
        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            guard !pending.isEmpty else { return }
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            case .denied, .restricted: finishAll(error: "Location permission is off")
            default: break
            }
        }
        func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
            guard let loc = locations.last else { return }
            let ids = pending; pending.removeAll()
            for id in ids {
                webView?.evaluateJavaScript("window.__cfLocation(\(id), true, \(loc.coordinate.latitude), \(loc.coordinate.longitude), \(loc.horizontalAccuracy))")
            }
        }
        func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finishAll(error: "Couldn't get your location") }
        private func finishAll(error: String) {
            let ids = pending; pending.removeAll()
            for id in ids { webView?.evaluateJavaScript("window.__cfLocation(\(id), false, 0, 0, 0, '\(error)')") }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { DebugLog.shared.add("loaded \(webView.url?.absoluteString ?? "")") }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { DebugLog.shared.add("load failed: \(error.localizedDescription)") }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { DebugLog.shared.add("load failed early: \(error.localizedDescription)") }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { DebugLog.shared.add("web process ended, reloading"); webView.reload() }

        // MARK: links open in Apple Maps / Safari, the app stays in the app
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.cancel) }
            if url.scheme == "campfinder" || url.scheme == "about" { return decisionHandler(.allow) }
            if action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) } // map tiles, iframes
            if action.navigationType == .linkActivated || action.targetFrame == nil {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }
    }
}

/// Serves files from the app bundle's `web` folder for campfinder://app/<path>.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("web")

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        DebugLog.shared.add("serve \(url.path)")
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            DebugLog.shared.add("missing file: \(file.lastPathComponent)")
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let headers = ["Content-Type": type, "Content-Length": "\(data.count)", "Cache-Control": "no-cache"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
