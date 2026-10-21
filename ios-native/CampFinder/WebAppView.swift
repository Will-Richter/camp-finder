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
        for name in ["location", "nativeFetch", "log", "places", "route", "journey", "speech"] { controller.add(context.coordinator, name: name) }
        controller.addUserScript(WKUserScript(source: Coordinator.logShim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(source: Coordinator.geolocationShim, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        // the app screen itself never zooms or slides around; only the map and lists move
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.scrollView.delegate = context.coordinator
        webView.allowsLinkPreview = false          // no long-press link previews
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.055, green: 0.353, blue: 0.243, alpha: 1)
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        context.coordinator.webView = webView
        AuthLinks.shared.deliver = { [weak coord = context.coordinator] url in coord?.sendAuthLink(url) }
        webView.load(URLRequest(url: URL(string: "campfinder://app/index.html")!))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, CLLocationManagerDelegate, UIScrollViewDelegate {
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { nil }   // no page zoom
        func scrollViewDidScroll(_ scrollView: UIScrollView) { if scrollView.contentOffset != .zero { scrollView.contentOffset = .zero } }
        weak var webView: WKWebView?
        private let manager = CLLocationManager()
        private var pending: [Int] = []
        private var watchers = Set<Int>()
        private func startWatching() {
            switch manager.authorizationStatus {
            case .notDetermined: manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse, .authorizedAlways: manager.startUpdatingLocation()
            default: break
            }
        }

        override init() {
            super.init()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            manager.distanceFilter = 8
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
          window.__cfLocation = function(id, ok, lat, lon, acc, msg, heading, speed){
            var c = cbs[id]; if (!c) return; if (!c.w) delete cbs[id];
            if (ok) c.s({coords:{latitude:lat, longitude:lon, accuracy:acc, heading:(heading >= 0 ? heading : null), speed:(speed >= 0 ? speed : null)}, timestamp:Date.now()});
            else if (c.e) c.e({code:1, message:msg});
          };
          var geo = {
            getCurrentPosition: function(s, e){ var id = next++; cbs[id] = {s:s, e:e};
              window.webkit.messageHandlers.location.postMessage(id); },
            watchPosition: function(s, e){ var id = next++; cbs[id] = {s:s, e:e, w:true};
              window.webkit.messageHandlers.location.postMessage({watch:id}); return id; },
            clearWatch: function(id){ delete cbs[id]; window.webkit.messageHandlers.location.postMessage({stop:id}); }
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
            "will-richter.github.io", "raw.githubusercontent.com", "places.googleapis.com",
            "api.open-meteo.com", "www.rfs.nsw.gov.au", "emergency.vic.gov.au", "publiccontent-gis-psba-qld-gov-au.s3.amazonaws.com",
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
            if let hs = dict["headers"] as? [String: String] {
                for (k, v) in hs where k.hasPrefix("X-Goog-") { req.setValue(v, forHTTPHeaderField: k) }
            }
            if host == "places.googleapis.com" { req.setValue(Bundle.main.bundleIdentifier, forHTTPHeaderField: "X-Ios-Bundle-Identifier") }
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
            case "speech":
                guard let d = message.body as? [String: Any] else { return }
                if (d["cmd"] as? String) == "start" {
                    SpeechListener.shared.send = { [weak self] text, final, err in
                        let payload: [String: Any] = ["text": text, "final": final, "error": err ?? NSNull()]
                        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
                        DispatchQueue.main.async { self?.webView?.evaluateJavaScript("window.__cfSpeech && window.__cfSpeech(\(String(decoding: data, as: UTF8.self)))") }
                    }
                    SpeechListener.shared.level = { [weak self] v in
                        self?.webView?.evaluateJavaScript("window.__cfSpeechLevel && window.__cfSpeechLevel(\(String(format: "%.2f", v)))")
                    }
                    SpeechListener.shared.start()
                } else if (d["cmd"] as? String) == "finish" {
                    SpeechListener.shared.finish()   // Search tapped: use what's been heard so far
                } else { SpeechListener.shared.stop() }
            case "journey":
                guard let d = message.body as? [String: Any] else { return }
                let result = JourneyRecorder.shared.handle(d) ?? NSNull()
                if let id = d["reply"] as? Int { reply("__cfJourneyDone", id, ok: true, result) }
            case "log": cfLog("web \(message.body)")
            case "location":
                if let d = message.body as? [String: Int] {
                    if let w = d["watch"] { watchers.insert(w); startWatching() }
                    if let st = d["stop"] { watchers.remove(st); if watchers.isEmpty { manager.stopUpdatingLocation() } }
                    return
                }
                guard let id = message.body as? Int else { return }
                // A recent fix answers straight away (no waiting for GPS)
                if let l = manager.location, -l.timestamp.timeIntervalSinceNow < 120, l.horizontalAccuracy > 0, l.horizontalAccuracy < 1500 {
                    send(l, to: [id]); return
                }
                pending.append(id)
                switch manager.authorizationStatus {
                case .notDetermined: manager.requestWhenInUseAuthorization()
                case .denied, .restricted: finishAll(error: "Location permission is off")
                default: quickFix()
                }
            default: break
            }
        }

        // MARK: location
        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            if !watchers.isEmpty, [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus) { manager.startUpdatingLocation() }
            guard !pending.isEmpty else { return }
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: quickFix()
            case .denied, .restricted: finishAll(error: "Location permission is off")
            default: break
            }
        }
        // Start updates and answer with the first reasonable fix, or the best one after 4 seconds
        private var bestFix: CLLocation?
        private var fixTimer: Timer?
        private func quickFix() {
            manager.startUpdatingLocation()
            fixTimer?.invalidate()
            fixTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in
                guard let self else { return }
                if let b = self.bestFix ?? self.manager.location { let ids = self.pending; self.pending.removeAll(); self.send(b, to: ids) }
                else { Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { [weak self] _ in self?.finishAll(error: "Couldn't get your location") } }
                if self.watchers.isEmpty && self.pending.isEmpty { self.manager.stopUpdatingLocation() }
            }
        }
        private func send(_ loc: CLLocation, to ids: [Int]) {
            let args = "\(loc.coordinate.latitude), \(loc.coordinate.longitude), \(loc.horizontalAccuracy), '', \(loc.course), \(loc.speed)"
            for id in ids { webView?.evaluateJavaScript("window.__cfLocation(\(id), true, \(args))") }
        }
        func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
            guard let loc = locations.last, loc.horizontalAccuracy > 0 else { return }
            if bestFix == nil || loc.horizontalAccuracy < bestFix!.horizontalAccuracy || -bestFix!.timestamp.timeIntervalSinceNow > 30 { bestFix = loc }
            if !pending.isEmpty && loc.horizontalAccuracy <= 300 {
                let ids = pending; pending.removeAll(); fixTimer?.invalidate()
                send(loc, to: ids)
                if watchers.isEmpty { manager.stopUpdatingLocation() }
            }
            if !watchers.isEmpty { send(loc, to: Array(watchers)) }
        }
        func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finishAll(error: "Couldn't get your location") }
        private func finishAll(error: String) {
            let ids = pending; pending.removeAll()
            for id in ids { webView?.evaluateJavaScript("window.__cfLocation(\(id), false, 0, 0, 0, '\(error)')") }
        }

        // MARK: sign-in links
        private var pageReady = false
        private var queuedLink: URL?
        func sendAuthLink(_ url: URL) {
            guard pageReady else { queuedLink = url; return }
            let s = (try? JSONSerialization.data(withJSONObject: [url.absoluteString])).map { String(decoding: $0, as: UTF8.self) } ?? "[]"
            webView?.evaluateJavaScript("window.__cfAuthLink && window.__cfAuthLink(\(s)[0])")
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            pageReady = true
            if let u = queuedLink ?? AuthLinks.shared.pending { queuedLink = nil; AuthLinks.shared.pending = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.sendAuthLink(u) }
            }
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
