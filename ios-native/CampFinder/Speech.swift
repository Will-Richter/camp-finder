import Foundation
import Speech
import AVFoundation

/// Speech-to-text for voice search ("Bundaberg to Cairns", "camp tonight").
/// Uses Apple's online recognition first (best with place names). With no signal it falls
/// back to on-device recognition (needs Dictation switched on in iPhone Settings).
final class SpeechListener {
    static let shared = SpeechListener()
    /// text, isFinal, error message
    var send: ((_ text: String, _ final: Bool, _ error: String?) -> Void)?
    /// microphone level 0...1, so the app can show it's hearing you
    var level: ((_ value: Double) -> Void)?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var silence: Timer?
    private var lastText = ""
    private var onDevice = true
    private var retried = false
    private var finished = false
    private var lastLevelAt = Date.distantPast
    private var session = 0

    func start() {
        stop()
        retried = false
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else { self.send?("", true, "Turn on Speech Recognition for Camp Finder in your iPhone Settings, then try again."); return }
                AVAudioSession.sharedInstance().requestRecordPermission { ok in
                    DispatchQueue.main.async {
                        guard ok else { self.send?("", true, "Turn on the Microphone for Camp Finder in your iPhone Settings, then try again."); return }
                        self.begin(onDevice: false)
                    }
                }
            }
        }
    }

    private func makeRecognizer() -> SFSpeechRecognizer? {
        for id in ["en-AU", Locale.current.identifier, "en-US"] {
            if let r = SFSpeechRecognizer(locale: Locale(identifier: id)), r.isAvailable { return r }
        }
        return nil
    }

    private func begin(onDevice wantOnDevice: Bool) {
        tearDown()
        guard let rec = makeRecognizer() else { send?("", true, "Voice search isn't available right now. Type where you're going instead."); return }
        recognizer = rec
        session += 1
        let mySession = session
        finished = false
        lastText = ""
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
            try audio.setActive(true, options: .notifyOthersOnDeactivation)

            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            req.taskHint = .search
            onDevice = wantOnDevice && rec.supportsOnDeviceRecognition
            req.requiresOnDeviceRecognition = onDevice
            if #available(iOS 16, *) { req.addsPunctuation = false }
            request = req

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "mic", code: 1) }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buf, _ in
                guard let self else { return }
                self.request?.append(buf)
                self.meter(buf)
            }
            engine.prepare()
            try engine.start()

            task = rec.recognitionTask(with: req) { [weak self] result, error in
                guard let self, mySession == self.session, !self.finished else { return }
                if let r = result {
                    let t = r.bestTranscription.formattedString
                    if !t.isEmpty { self.lastText = t }
                    if r.isFinal { self.finish(); return }
                    self.send?(self.lastText, false, nil)
                    self.armSilence(after: 1.4)
                } else if let error {
                    NSLog("[speech] error (onDevice=\(self.onDevice)): \(error.localizedDescription)")
                    if self.lastText.isEmpty && !self.onDevice && !self.retried && (self.recognizer?.supportsOnDeviceRecognition ?? false) {
                        // Online recognition failed (usually no signal): try on-device instead
                        self.retried = true
                        DispatchQueue.main.async { self.begin(onDevice: true) }
                        return
                    }
                    self.finish()
                }
            }
            armSilence(after: 7)
        } catch {
            NSLog("[speech] couldn't start: \(error.localizedDescription)")
            send?("", true, "Couldn't start the microphone. Close other apps using it and try again.")
            tearDown()
        }
    }

    /// Ends listening and sends whatever was heard.
    func finish() {
        guard !finished else { return }
        finished = true
        let text = lastText
        tearDown()
        send?(text, true, text.isEmpty ? "I didn't hear anything. Tap Try again and speak clearly, or type it in." : nil)
    }

    private func meter(_ buf: AVAudioPCMBuffer) {
        guard let ch = buf.floatChannelData?[0], buf.frameLength > 0 else { return }
        let now = Date()
        guard now.timeIntervalSince(lastLevelAt) > 0.08 else { return }
        lastLevelAt = now
        var sum: Float = 0
        let n = Int(buf.frameLength)
        for i in 0..<n { sum += ch[i] * ch[i] }
        let rms = sqrt(sum / Float(n))
        let db = 20 * log10(max(rms, 0.000_01))           // about -100 ... 0
        let v = Double(min(1, max(0, (db + 55) / 45)))      // quiet room ≈ 0, talking ≈ 0.5–1
        DispatchQueue.main.async { self.level?(v) }
    }

    private func armSilence(after seconds: TimeInterval) {
        DispatchQueue.main.async {
            self.silence?.invalidate()
            let mySession = self.session
            self.silence = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
                guard let self, mySession == self.session else { return }
                self.finish()
            }
        }
    }

    private func tearDown() {
        silence?.invalidate(); silence = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio(); request = nil
        task?.cancel(); task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Cancel without sending anything.
    func stop() {
        finished = true
        session += 1
        tearDown()
    }
}
