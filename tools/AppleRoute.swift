// Routes with Apple Maps (MKDirections), the same way the iPhone app does, for the route options check in CI.
// Reads one request per line:   {"id": 1, "from": [lat, lon], "to": [lat, lon]}
// Writes one answer per line:    {"id": 1, "ok": true, "distance": m, "duration": s, "coordinates": [[lon, lat], ...]}
// swiftc -parse-as-library tools/AppleRoute.swift -o appleroute
import Foundation
import MapKit

@main
struct AppleRoute {
    static func main() {
        Thread.detachNewThread {
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      let id = req["id"] as? Int, let a = req["from"] as? [Double], let b = req["to"] as? [Double],
                      a.count == 2, b.count == 2 else { continue }
                var out: [String: Any] = ["id": id, "ok": false]
                for attempt in 0..<4 {
                    let done = DispatchSemaphore(value: 0)
                    var retry = false
                    DispatchQueue.main.async {
                        let r = MKDirections.Request()
                        r.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: a[0], longitude: a[1])))
                        r.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: b[0], longitude: b[1])))
                        r.transportType = .automobile
                        MKDirections(request: r).calculate { res, err in
                            if let route = res?.routes.first {
                                // as the app does: at most about 4000 points a leg
                                let n = route.polyline.pointCount
                                var pts = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: n)
                                route.polyline.getCoordinates(&pts, range: NSRange(location: 0, length: n))
                                let step = max(1, n / 4000)
                                var coords: [[Double]] = []
                                for i in Swift.stride(from: 0, to: n, by: step) { coords.append([pts[i].longitude, pts[i].latitude]) }
                                if let last = pts.last { coords.append([last.longitude, last.latitude]) }
                                out = ["id": id, "ok": true, "distance": route.distance, "duration": route.expectedTravelTime, "coordinates": coords]
                            } else {
                                let msg = err?.localizedDescription ?? "No route"
                                out["error"] = msg
                                if let e = err as? MKError, e.code == .loadingThrottled { retry = true }
                                if msg.lowercased().contains("throttl") { retry = true }
                            }
                            done.signal()
                        }
                    }
                    done.wait()
                    if !retry { break }
                    FileHandle.standardError.write("throttled, waiting (attempt \(attempt + 1))\n".data(using: .utf8)!)
                    Thread.sleep(forTimeInterval: 20)
                }
                if let json = try? JSONSerialization.data(withJSONObject: out), let s = String(data: json, encoding: .utf8) {
                    print(s); fflush(stdout)
                }
            }
            exit(0)
        }
        RunLoop.main.run()
    }
}
