import SwiftUI
import WebKit
import CoreLocation
import MapKit
import UniformTypeIdentifiers

/// Diagnostics go to the Xcode console only (never on screen).
@inline(__always) func cfLog(_ s: @autoclosure () -> String) {
    #if DEBUG
    print("[CampFinder] \(s())")
    #endif
}

/// Hosts the bundled Camp Finder web app (the `web` folder) in a WKWebView.
/// Files are served from a custom `campfinder://app/` scheme so the page has a stable origin.
/// Place search and driving directions use Apple Maps (MapKit), so they don't depend on public servers.
struct WebAppView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "campfinder")
        config.allowsInlineMediaPlayback = true
        config.websiteDataStore = .default()

        let controller = config.userContentController
        for name in ["location", "nativeFetch", "log", "places", "route"] { controller.add(context.coordinator, name: name) }
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

        /// Sends page errors and console messages to the Xcode console.
        static let logShim = """
        (function(){
          var post = function(kind, msg){ try { window.webkit.messageHandlers.log.postMessage(kind + ': ' + msg); } catch (e) {} };
          window.addEventListener('error', function(e){ post('error', (e.message || e.type) + ' @ ' + (e.filename || (e.target && (e.target.src || e.target.href)) || '') + ':' + (e.lineno || '')); }, true);
          window.addEventListener('unhandledrejection', function(e){ post('promise', String(e.reason && (e.reason.stack || e.reason.message) || e.reason)); });
          ['error','warn'].forEach(function(k){ var o = console[k]; console[k] = function(){ post(k, Array.prototype.map.call(arguments, String).join(' ')); o.apply(console, arguments); }; });
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

        // MARK: replies to the page
        private func reply(_ fn: String, _ id: Int, ok: Bool, _ value: Any) {
            let payload = (try? JSONSerialization.data(withJSONObject: [value], options: [.fragmentsAllowed])).map { String(decoding: $0, as: UTF8.self) } ?? "[null]"
            DispatchQueue.main.async { self.webView?.evaluateJavaScript("window.\(fn)(\(id), \(ok), \(payload)[0])") }
        }

        // MARK: data fetches through the app (no browser limits, proper app identity)
        private static let fetchHosts: Set<String> = [
            "spatial.infrastructure.gov.au", "opendata.maps.vic.gov.au",
            "catalogue.data.infrastructure.gov.au", "spatial-gis.information.qld.gov.au",
            "overpass-api.de", "overpass.kumi.systems", "overpass.private.coffee",
            "will-richter.github.io", "raw.githubusercontent.com",
        ]
        private func handleFetch(_ body: Any) {
            guard let dict = body as? [String: Any], let id = dict["id"] as? Int,
                  let str = dict["url"] as? String, let url = URL(string: str),
                  url.scheme == "https", let host = url.host, Self.fetchHosts.contains(host) else { return }
            var req = URLRequest(url: url, timeoutInterval: (dict["timeout"] as? Double) ?? 25)
            req.setValue("GoneLappinCampFinder/1.0 (iOS; au.com.gonelappin.campfinder)", forHTTPHeaderField: "User-Agent")
            if let method = dict["method"] as? String { req.httpMethod = method }
            if let b = dict["body"] as? String { req.httpBody = b.data(using: .utf8) }
            if let ct = dict["contentType"] as? String { req.setValue(ct, forHTTPHeaderField: "Content-Type") }
            URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
                let ok = error == nil && ((response as? HTTPURLResponse)?.statusCode ?? 0) < 400 && data != nil
                let text = ok ? String(decoding: data!, as: UTF8.self) : (error?.localizedDescription ?? "HTTP error")
                if !ok { cfLog("fetch failed \(host): \(text)") }
                self?.reply("__cfFetchDone", id, ok: ok, text)
            }.resume()
        }

        // MARK: Apple Maps place search
        private static let australia = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: -26.5, longitude: 134.0),
                                                         span: MKCoordinateSpan(latitudeDelta: 38, longitudeDelta: 46))
        private func handlePlaces(_ body: Any) {
            guard let dict = body as? [String: Any], let id = dict["id"] as? Int, let q = dict["q"] as? String else { return }
            let req = MKLocalSearch.Request()
            req.naturalLanguageQuery = q
            req.region = Self.australia
            req.resultTypes = [.address, .pointOfInterest]
            MKLocalSearch(request: req).start { [weak self] res, err in
                guard let items = res?.mapItems, err == nil else {
                    cfLog("place search failed: \(err?.localizedDescription ?? "none")")
                    self?.reply("__cfPlacesDone", id, ok: false, err?.localizedDescription ?? "No results"); return
                }
                let out: [[String: Any]] = items.compactMap { item in
                    let pm = item.placemark
                    guard pm.countryCode == nil || pm.countryCode == "AU" else { return nil }
                    let name = item.name ?? pm.locality ?? q
                    let area = [pm.locality != name ? pm.locality : nil, pm.administrativeArea].compactMap { $0 }.joined(separator: ", ")
                    return ["name": name, "area": area, "lat": pm.coordinate.latitude, "lon": pm.coordinate.longitude]
                }
                self?.reply("__cfPlacesDone", id, ok: true, Array(out.prefix(6)))
            }
        }

        // MARK: Apple Maps driving directions
        private func handleRoute(_ body: Any) {
            guard let dict = body as? [String: Any], let id = dict["id"] as? Int,
                  let a = dict["from"] as? [Double], let b = dict["to"] as? [Double], a.count == 2, b.count == 2 else { return }
            let wantSteps = (dict["steps"] as? Bool) ?? false
            let req = MKDirections.Request()
            req.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: a[0], longitude: a[1])))
            req.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: b[0], longitude: b[1])))
            req.transportType = .automobile
            MKDirections(request: req).calculate { [weak self] res, err in
                guard let route = res?.routes.first, err == nil else {
                    cfLog("route failed: \(err?.localizedDescription ?? "none")")
                    self?.reply("__cfRouteDone", id, ok: false, err?.localizedDescription ?? "No route"); return
                }
                let n = route.polyline.pointCount
                var pts = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: n)
                route.polyline.getCoordinates(&pts, range: NSRange(location: 0, length: n))
                let stride = max(1, n / 4000) // keep long routes light
                var coords: [[Double]] = []
                for i in Swift.stride(from: 0, to: n, by: stride) { coords.append([pts[i].longitude, pts[i].latitude]) }
                if let last = pts.last { coords.append([last.longitude, last.latitude]) }
                var out: [String: Any] = ["distance": route.distance, "duration": route.expectedTravelTime, "coordinates": coords]
                if wantSteps {
                    out["steps"] = route.steps.filter { !$0.instructions.isEmpty }.map { ["text": $0.instructions, "distance": $0.distance] }
                }
                self?.reply("__cfRouteDone", id, ok: true, out)
            }
        }

        // MARK: messages from the page
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            switch message.name {
            case "nativeFetch": handleFetch(message.body)
            case "places": handlePlaces(message.body)
            case "route": handleRoute(message.body)
            case "log": cfLog("web \(message.body)")
            case "location":
                guard let id = message.body as? Int else { return }
                pending.append(id)
                switch manager.authorizationStatus {
                case .notDetermined: manager.requestWhenInUseAuthorization()
                case .denied, .restricted: finishAll(error: "Location permission is off")
                default: manager.requestLocation()
                }
            default: break
            }
        }

        // MARK: location
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

        // MARK: navigation
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { cfLog("load failed: \(error)") }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { cfLog("load failed early: \(error)") }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { cfLog("web process ended, reloading"); webView.reload() }

        // Links open in Apple Maps / Safari; the app stays in the app
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.cancel) }
            if url.scheme == "campfinder" || url.scheme == "about" { return decisionHandler(.allow) }
            if action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
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
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            cfLog("missing file: \(file.lastPathComponent)")
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
