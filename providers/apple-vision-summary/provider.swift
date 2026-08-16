import Foundation
import Vision

private let schemaVersion = "cimmich.apple-vision-summary.raw.v1"
private let adapterVersion = "cimmich-apple-vision-summary-v1"

private let runtime: [String: Any] = [
    "adapterVersion": adapterVersion,
    "operatingSystem": ProcessInfo.processInfo.operatingSystemVersionString,
]

private func emit(_ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

private func confidenceRow(_ identifier: String, _ confidence: VNConfidence) -> [String: Any] {
    ["confidence": Double(confidence), "identifier": identifier]
}

let arguments = Array(CommandLine.arguments.dropFirst())
let emitArray = arguments.contains("--json-array")
let runOcr = !arguments.contains("--skip-ocr")
let paths = arguments.filter { !["--json-array", "--skip-ocr"].contains($0) }
guard !paths.isEmpty else {
    FileHandle.standardError.write(
        Data("usage: cimmich-apple-vision-summary [--json-array] [--skip-ocr] IMAGE...\n".utf8)
    )
    exit(2)
}

private func analyse(_ path: String, runOcr: Bool) -> [String: Any] {
    let started = ContinuousClock.now
    let url = URL(fileURLWithPath: path)
    let classifications = VNClassifyImageRequest()
    let faces = VNDetectFaceRectanglesRequest()
    let humans = VNDetectHumanRectanglesRequest()
    humans.upperBodyOnly = false
    let animals = VNRecognizeAnimalsRequest()
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .accurate
    text.usesLanguageCorrection = false
    text.minimumTextHeight = 0.01

    var errors: [String] = []
    do {
        try VNImageRequestHandler(url: url, options: [:]).perform([classifications])
    } catch {
        errors.append("classification: \(String(describing: error))")
    }
    do {
        var requests: [VNRequest] = [faces, humans, animals]
        if runOcr { requests.append(text) }
        try VNImageRequestHandler(url: url, options: [:]).perform(requests)
    } catch {
        errors.append("specialists: \(String(describing: error))")
    }

    let classificationRows = (classifications.results ?? [])
        .filter { $0.confidence >= 0.01 }
        .prefix(20)
        .map { confidenceRow($0.identifier, $0.confidence) }
    let animalRows = (animals.results ?? []).map { observation in
        [
            "confidence": Double(observation.confidence),
            "labels": observation.labels.prefix(3).map {
                confidenceRow($0.identifier, $0.confidence)
            },
        ] as [String: Any]
    }
    let textRows = (text.results ?? []).compactMap { observation -> [String: Any]? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return confidenceRow(candidate.string, candidate.confidence)
    }
    let elapsed = started.duration(to: .now)
    let elapsedSeconds = Double(elapsed.components.seconds)
        + Double(elapsed.components.attoseconds) / 1_000_000_000_000_000_000

    return [
        "animals": animalRows,
        "classifications": classificationRows,
        "elapsedSeconds": elapsedSeconds,
        "errors": errors,
        "faceCount": (faces.results ?? []).count,
        "humanCount": (humans.results ?? []).count,
        "imagePath": path,
        "ocrPerformed": runOcr,
        "runtime": runtime,
        "schemaVersion": schemaVersion,
        "visibleText": textRows,
    ]
}

do {
    let results = paths.map { analyse($0, runOcr: runOcr) }
    if emitArray {
        try emit(["results": results, "runtime": runtime, "schemaVersion": schemaVersion])
    } else {
        for result in results { try emit(result) }
    }
} catch {
    FileHandle.standardError.write(Data("apple vision output failed: \(error)\n".utf8))
    exit(1)
}
