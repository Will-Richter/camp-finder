import Foundation
import Speech
import AVFoundation

/// On-device speech-to-text for voice search ("Bundaberg to Cairns", "camp tonight").
final class SpeechListener {
    static let shared = SpeechListener()
    var send: ((_ text: String, _ final: Bool, _ error: String?) -> Void)?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-AU"))
    private var silence: Timer?
    private var lastText = ""

    func start() {
        stop(quiet: true)
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else { self.send?("", true, "Turn on Speech Recognition for Camp Finder in your iPhone Settings"); return }
                AVAudioSession.sharedInstance().requestRecordPermission { ok in
                    DispatchQueue.main.async {
                        guard ok else { self.send?("", true, "Turn on the Microphone for Camp Finder in your iPhone Settings"); return }
                        self.begin()
                    }
                }
            }
        }
    }

    private func begin() {
        guard let recognizer, recognizer.isAvailable else { send?("", true, "Voice search isn't available right now"); return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true } // works with no signal
            request = req
            lastText = ""
            let input = engine.inputNode
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [weak self] buf, _ in self?.request?.append(buf) }
            engine.prepare()
            try engine.start()
            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                guard let self else { return }
                if let r = result {
                    self.lastText = r.bestTranscription.formattedString
                    self.send?(self.lastText, r.isFinal, nil)
                    self.armSilence()
                    if r.isFinal { self.stop(quiet: true) }
                } else if error != nil {
                    self.send?(self.lastText, true, self.lastText.isEmpty ? "Didn't catch that. Tap the microphone and try again." : nil)
                    self.stop(quiet: true)
                }
            }
            armSilence(first: true)
        } catch {
            send?("", true, "Couldn't start the microphone")
            stop(quiet: true)
        }
    }

    // Finish automatically after a short pause in speech
    private func armSilence(first: Bool = false) {
        DispatchQueue.main.async {
            self.silence?.invalidate()
            self.silence = Timer.scheduledTimer(withTimeInterval: first ? 6 : 1.6, repeats: false) { [weak self] _ in self?.request?.endAudio() }
        }
    }

    func stop(quiet: Bool = false) {
        silence?.invalidate(); silence = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio(); request = nil
        if !quiet { task?.finish() }
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
