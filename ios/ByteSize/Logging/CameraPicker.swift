import PhotosUI
import SwiftUI
import UIKit

/// The system camera for one still photo.
struct CameraPicker: UIViewControllerRepresentable {
    let onPhoto: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onPhoto(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

/// "Take photo" (when there's a camera) and "Choose photo": either way, a JPEG ready to upload.
struct PhotoButtons: View {
    #if DEBUG
    static let testPlatePhoto = "STUB-PLATE"
    static let testBarcodePhoto = "STUB-BARCODE"
    #endif
    var takeTitle = "Take photo"
    var chooseTitle = "Choose photo"
    let onJPEG: (Data) -> Void
    @State private var cameraOpen = false
    @State private var item: PhotosPickerItem?

    var body: some View {
        VStack(spacing: 12) {
            if CameraPicker.isAvailable {
                Button { cameraOpen = true } label: {
                    Label(takeTitle, systemImage: "camera").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            PhotosPicker(selection: $item, matching: .images) {
                Label(chooseTitle, systemImage: "photo.on.rectangle").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            #if DEBUG
            // UI tests: the simulator has no camera, so a pretend photo stands in (the stub server reads it)
            if StubServer.isOn {
                // Bordered: in a Form row, plain buttons would all fire on any tap
                Button("Use test photo") { onJPEG(Data(Self.testPlatePhoto.utf8)) }.buttonStyle(.bordered).accessibilityIdentifier("testPhoto")
                Button("Use test barcode photo") { onJPEG(Data(Self.testBarcodePhoto.utf8)) }.buttonStyle(.bordered).accessibilityIdentifier("testBarcodePhoto")
            }
            #endif
        }
        .fullScreenCover(isPresented: $cameraOpen) {
            CameraPicker { image in
                if let jpeg = image.uploadJPEG() { onJPEG(jpeg) }
            }
            .ignoresSafeArea()
        }
        .onChange(of: item) { _, picked in
            guard let picked else { return }
            Task {
                if let data = try? await picked.loadTransferable(type: Data.self), let image = UIImage(data: data), let jpeg = image.uploadJPEG() {
                    onJPEG(jpeg)
                }
                item = nil
            }
        }
    }
}

extension UIImage {
    /// At most 1600 px on the long side, upright, as a JPEG (what the server reads anyway).
    func uploadJPEG(maxSide: CGFloat = 1600) -> Data? {
        let long = max(size.width, size.height)
        let scale = long > maxSide ? maxSide / long : 1
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
        return resized.jpegData(compressionQuality: 0.85)
    }
}
