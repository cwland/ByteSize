import Foundation

/// One call to the ByteSize server and the JSON it answers with.
public struct Endpoint<Response: Decodable & Sendable>: Sendable {
    public let method: String
    public let path: String
    public let query: [URLQueryItem]
    public let body: Data?
    /// The body's Content-Type (JSON unless it's a form upload).
    public let contentType: String?
    /// A 401 from this call means "you're signed out" (false for sign-in itself, where 401 is a wrong password).
    public let signsOut: Bool
    /// Seconds to wait for the answer: AI calls (photos, estimates) can take a while.
    public let timeout: TimeInterval

    public init(_ method: String, _ path: String, query: [URLQueryItem] = [], json: (any Encodable)? = nil, signsOut: Bool = true, timeout: TimeInterval = 20) {
        self.method = method
        self.path = path
        self.query = query
        self.body = json.flatMap { try? JSONEncoder().encode($0) }
        self.contentType = json == nil ? nil : "application/json"
        self.signsOut = signsOut
        self.timeout = timeout
    }

    /// A form upload (multipart/form-data), e.g. photos.
    public init(_ method: String, _ path: String, multipart parts: [MultipartPart], boundary: String = "ByteSize-\(UUID().uuidString)", timeout: TimeInterval = 20) {
        self.method = method
        self.path = path
        self.query = []
        self.body = MultipartPart.body(parts, boundary: boundary)
        self.contentType = "multipart/form-data; boundary=\(boundary)"
        self.signsOut = true
        self.timeout = timeout
    }
}

/// One field or file of a form upload.
public struct MultipartPart: Sendable {
    public let name: String
    public let filename: String?
    public let contentType: String?
    public let data: Data

    public static func field(_ name: String, _ value: String) -> MultipartPart {
        MultipartPart(name: name, filename: nil, contentType: nil, data: Data(value.utf8))
    }

    public static func file(_ name: String, filename: String, contentType: String, data: Data) -> MultipartPart {
        MultipartPart(name: name, filename: filename, contentType: contentType, data: data)
    }

    static func body(_ parts: [MultipartPart], boundary: String) -> Data {
        var out = Data()
        for part in parts {
            var head = "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(part.name)\""
            if let filename = part.filename { head += "; filename=\"\(filename)\"" }
            head += "\r\n"
            if let type = part.contentType { head += "Content-Type: \(type)\r\n" }
            head += "\r\n"
            out.append(Data(head.utf8))
            out.append(part.data)
            out.append(Data("\r\n".utf8))
        }
        out.append(Data("--\(boundary)--\r\n".utf8))
        return out
    }
}

/// For calls whose answer we don't need beyond "it worked" (e.g. `{ "ok": true }`).
public struct Empty: Codable, Equatable, Sendable {
    public init() {}
}
