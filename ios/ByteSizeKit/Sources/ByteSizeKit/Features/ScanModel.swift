import Foundation
import Observation

/// Scan Food: a barcode is looked up; one nobody knows yet can have its nutrition label photographed and read by
/// the AI, then saved as the person's own food bound to that barcode (so the next scan finds it).
@MainActor
@Observable
public final class ScanModel {
    public enum Step: Equatable {
        case scanning
        case looking(String)
        case found(Food)
        case notFound(String)
        case readingLabel
        case review(AiDraft, barcode: String)
        case saving
        case saved(Food)
        case failed(String)
    }

    public private(set) var step: Step = .scanning
    /// The barcode being worked on (kept through a failed label read, so it can be tried again).
    public private(set) var code: String?
    /// Why the last save didn't work (shown on the review form, edits kept).
    public private(set) var message: String?
    /// The food just logged; the camera is back for the next barcode (SPEC-16).
    public private(set) var lastLogged: String?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private var lastRead: AiDraft?

    public static let unreadable = "Couldn't read that label. Try again with the whole Nutrition Facts panel in view."
    public static let needsPhotoAI = "Reading labels needs a photo AI service — set one up in the web app."

    public init(api: APIClient) {
        self.api = api
    }

    /// A code from the camera or typed. Ignored unless scanning (the camera reports the same code many times).
    public func scanned(_ raw: String) async {
        guard step == .scanning else { return }
        let digits = raw.filter { $0.isASCII && $0.isNumber }
        guard !digits.isEmpty else { return }
        code = digits
        step = .looking(digits)
        do {
            let hit = try await api.send(FoodAPI.barcode(digits))
            step = hit.food.map(Step.found) ?? .notFound(digits)
        } catch {
            step = .failed(Self.text(error))
        }
    }

    /// The label photo for the barcode that wasn't found.
    public func readLabel(jpeg: Data) async {
        guard let code else { return }
        step = .readingLabel
        do {
            let result = try await api.send(FoodAPI.analyzePhoto(jpeg: jpeg, mode: .label))
            if let draft = result.draft {
                lastRead = draft
                step = .review(draft, barcode: code)
            } else {
                step = .failed(result.labelReading ? Self.unreadable : Self.needsPhotoAI)
            }
        } catch APIError.server(503, _) {
            step = .failed(Self.needsPhotoAI)
        } catch {
            step = .failed(Self.text(error))
        }
    }

    /// Saves the (checked, maybe edited) label as the person's food with the barcode.
    public func save(_ draft: AiDraft) async {
        guard let code else { return }
        // What the AI read, so values the person corrected aren't marked AI
        let read = lastRead
        step = .saving
        message = nil
        do {
            let saved = try await api.send(FoodAPI.saveFood(draft, barcode: code, original: read))
            step = .saved(saved.food)
        } catch {
            // Back to the form with what they typed, to fix and save again
            message = Self.text(error)
            step = .review(draft, barcode: code)
        }
    }

    /// A scanned food was logged: back to the camera for the next one.
    public func logged(_ name: String) {
        restart()
        lastLogged = name
    }

    public func restart() {
        lastRead = nil
        step = .scanning
        code = nil
        message = nil
    }

    private static func text(_ error: Error) -> String {
        (error as? APIError)?.message ?? error.localizedDescription
    }
}
